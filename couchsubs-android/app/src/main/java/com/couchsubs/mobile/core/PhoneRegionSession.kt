// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import kotlin.math.abs

/** Telefon açıkken alınan kare ve o karedeki telefonun pozu. Kare kopyadır; çağrıdan sonra da geçerlidir. */
class PhoneCapture(val image: PhoneImage, val pose: GamePhoneGeometry.Pose) {
    val region: CropRegion get() = pose.bounds
}

/**
 * Tek telefon açılışının son karesi, okunmuş balonları ve birebir çevirileri. Ana altyazı ve elle seçilen bölgeler kendi
 * saatlerinde kalır. Telefon kapanınca bu oturum tekrar kullanılmaz (Mac/iPhone PhoneRegionSession.swift, Windows
 * RegionWatcher.Phone.cs ile aynı kurallar).
 *
 * Android'de kare yalnız izleyicinin telefonu bulduğu örneklerde kopyalanır ([GamePhoneTracker.INTERVAL_MS]); her
 * [PhoneCapture] telefonun o karede görüldüğü anlamına gelir, ayrıca yeniden aranmaz. [observe] ve [close] kare iş
 * parçacığından, [visit] ek alanların iş parçacığından çağrılır.
 */
internal class PhoneRegionSession(
    private val reader: (GamePhoneReader.Flat) -> Reading,
    private val translator: TextTranslator,
    private val sender: RegionSender,
) {
    companion object {
        const val ID = SubtitleServer.GAME_PHONE_ID
        const val INTERVAL_MS = 450L
    }

    private class Bubble(val group: ScreenTranslation.Group, val style: TextSurface)

    private class Page(val region: CropRegion, val signature: ByteArray, val pixels: GamePhonePage, val bubbles: List<Bubble>)

    private class Anchor(val prefix: String, val x: Double, val y: Double)

    @Volatile private var latest: PhoneCapture? = null
    @Volatile private var closed = false
    private var lastPass: Long? = null
    private var page: Page? = null
    private var rendered: List<ScreenTranslation.Item> = emptyList()
    private val translations = HashMap<String, String>()
    private val keys = ArrayList<String>()
    private var nextBubble = 0
    private var anchors: List<Anchor> = emptyList()
    private var needsWork = false
    private var emptyOnce = false

    fun observe(capture: PhoneCapture) {
        if (!closed) latest = capture
    }

    fun beginIfDue(time: Long): Boolean {
        if (latest == null) return false
        lastPass?.let { if (time - it < INTERVAL_MS) return false }
        lastPass = time
        return true
    }

    fun close(): Unit = synchronized(this) {
        closed = true
        latest = null
        publish(emptyList())
    }

    fun visit(packLookup: ((String) -> PackMatch?)?, skipsTurkish: Boolean, english: Boolean) {
        if (latest == null) return
        update(packLookup, skipsTurkish, english)
    }

    private fun read(capture: PhoneCapture, signature: ByteArray): Page {
        val region = capture.region
        val reading = GamePhoneText.forTranslation(GamePhoneReader.read(capture.image, region, capture.pose, reader))
        val place = region.box
        val groups = GamePhoneText.groups(reading)
        val icons = if (groups.any { it.icons != null }) capture.image.gray(region) else null
        val bubbles = ScreenTranslation.withImages(groups, icons).map { group ->
            val box = group.box.placedIn(place)
            Bubble(group.copy(box = box, lineHeight = group.lineHeight * (region.bottom - region.top)), GamePhonePalette.sample(capture.image, box))
        }
        return Page(region, signature, GamePhonePage(capture.image, region, reading), bubbles)
    }

    private fun update(packLookup: ((String) -> PackMatch?)?, skipsTurkish: Boolean, english: Boolean) {
        val start = latest ?: run { clearMissing(); return }
        val signature = start.image.signature(start.region)
        val changed = page?.let {
            !it.region.isClose(start.region, 0.01) || RegionSignature.changed(it.signature, signature) ||
                it.pixels.changed(start.image, start.region)
        } ?: true
        if (changed || emptyOnce) {
            page = try {
                read(start, signature)
            } catch (error: Exception) {
                page = null
                return
            }
        } else if (!needsWork) {
            return
        }
        if (closed) return
        var current = page ?: return
        var verified = latest ?: return
        // Okuma sürerken farklı bir sayfa gelmişse eski sayfadan yeni çeviri isteği çıkarma.
        if (start.image !== verified.image && !matches(current, verified)) {
            current = reread(verified) ?: run { clearMissing(); return }
        }
        if (closed) return
        if (current.bubbles.isEmpty()) {
            if (emptyOnce || rendered.isEmpty()) {
                publish(emptyList())
                emptyOnce = false
            } else {
                emptyOnce = true
            }
            needsWork = false
            return
        }
        emptyOnce = false
        val groups = current.bubbles.map { it.group }
        val paragraphs = groups.flatMap { it.paragraphs }
        var available = availableTranslations(paragraphs, packLookup, skipsTurkish)
        // Önce yalnız güncel sayfayla eşleşen balonlar kalır. Örneğin yeni WhatUp yanıtı ağdayken önceki yanıtın üstü
        // kendi özgün yazısıyla görünür, bitmiş komşu balonlar okunabilir.
        publish(items(current, available))
        var missing = paragraphs.filter { available[it] == null }
        if (missing.isEmpty()) {
            needsWork = false
            return
        }
        if (!translator.translatesTogether) {
            followPage(current)
            for (offset in groups.indices) {
                val index = (nextBubble + offset) % groups.size
                val lead = groups[index].paragraphs.filter { available[it] == null }
                if (lead.any(GamePhoneText::isMessagePreview)) {
                    missing = lead
                    nextBubble = (index + 1) % groups.size
                    break
                }
            }
        }
        missing = missing.distinct()
        val inputs = missing.map {
            val text = IconText.protect(it).text
            if (english) GamePhoneText.englishModelInput(text) else text
        }
        try {
            // Aynı çevirmen örneğinin bağlamına iki iş parçacığı birden yazmasın (ek alanların ön çevirisi).
            val result = synchronized(translator) { translator.translateAll(inputs) }
            if (closed) return
            if (result.size != inputs.size) {
                needsWork = true
                return
            }
            for ((source, translated) in missing.zip(result)) if (translated.isNotBlank()) {
                remember(source, translated)
                available[source] = translated
            }
        } catch (error: Exception) {
            needsWork = true
            return
        }
        val last = latest ?: return
        if (last.image !== verified.image && !matches(current, last)) {
            verified = last
            current = reread(verified) ?: run { clearMissing(); return }
            available = availableTranslations(current.bubbles.flatMap { it.group.paragraphs }, packLookup, skipsTurkish)
        }
        if (closed) return
        publish(items(current, available))
        needsWork = current.bubbles.any { bubble -> bubble.group.paragraphs.any { available[it] == null } }
    }

    private fun matches(page: Page, capture: PhoneCapture): Boolean =
        page.region.isClose(capture.region, 0.01) && !page.pixels.changed(capture.image, capture.region)

    private fun reread(capture: PhoneCapture): Page? {
        if (closed) return null
        val fresh = try {
            read(capture, capture.image.signature(capture.region))
        } catch (error: Exception) {
            return null
        }
        val last = latest ?: return null
        if (closed || !(last.image === capture.image || matches(fresh, last))) return null
        page = fresh
        return fresh
    }

    private fun clearMissing() {
        page = null
        emptyOnce = false
        needsWork = false
        publish(emptyList())
    }

    private fun remember(source: String, translation: String) {
        if (translations[source] == null) {
            if (keys.size >= 2 * ScreenTranslation.MAX_GROUPS) translations.remove(keys.removeAt(0))
            keys.add(source)
        }
        translations[source] = translation
    }

    private fun availableTranslations(
        paragraphs: List<String>, packLookup: ((String) -> PackMatch?)?, skipsTurkish: Boolean,
    ): MutableMap<String, String> {
        val result = HashMap<String, String>()
        for (text in paragraphs) {
            val known = packLookup?.invoke(IconText.plain(text))?.text ?: translations[text]
                ?: if (skipsTurkish && TurkishText.isSure(text)) text else null
            if (known != null) result[text] = known else result.remove(text)
        }
        return result
    }

    private fun items(page: Page, translations: Map<String, String>): List<ScreenTranslation.Item> =
        page.bubbles.mapNotNull { bubble ->
            val group = bubble.group
            val result = group.paragraphs.mapNotNull { GamePhoneText.keepIdentifiers(it, translations[it]) }
            if (result.size != group.paragraphs.size) return@mapNotNull null
            ScreenTranslation.item(group, group.paragraphs.map(IconText::protect), result)?.copy(surface = bubble.style)
        }

    private fun publish(items: List<ScreenTranslation.Item>): Unit = synchronized(this) {
        // Kapanan telefonun bekleyen çevirisi oyunun üstüne çizilmez.
        if (closed && items.isNotEmpty()) return
        if (rendered == items) return
        rendered = items
        val box = items.map { it.box }.reduceOrNull { a, b -> a.union(b) }
        val heights = items.map { it.lineHeight }.sorted()
        sender.sendRegion(ID, items.joinToString("\n") { it.translation }, box,
            if (heights.isEmpty()) null else heights[heights.size / 2], null, items.takeIf { it.isNotEmpty() })
    }

    /** Mesaj listesi kaydıysa (önizlemeler başka yerde) sıradaki balon baştan seçilir. */
    private fun followPage(page: Page) {
        val w = page.region.right - page.region.left
        val h = page.region.bottom - page.region.top
        val current = page.bubbles.mapNotNull { bubble ->
            val first = bubble.group.paragraphs.firstOrNull()?.takeIf(GamePhoneText::isMessagePreview) ?: return@mapNotNull null
            Anchor(TextMatch.normalize(first).split(' ').filter { it.isNotEmpty() }.take(3).joinToString(" "),
                (bubble.group.box.left - page.region.left) / w, (bubble.group.box.top - page.region.top) / h)
        }
        if (current.isNotEmpty()) {
            if (current.none { b -> anchors.any { a -> a.prefix == b.prefix && abs(a.x - b.x) <= 0.10 && abs(a.y - b.y) <= 0.08 } }) nextBubble = 0
            anchors = current
        }
    }
}
