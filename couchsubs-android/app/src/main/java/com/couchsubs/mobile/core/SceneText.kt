// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import kotlin.math.abs

/**
 * Oyun dünyasındaki yazı (tabela, tişört, plaka, afiş) altyazı alanına düşse de altyazı değildir. Alt bölge karenin
 * üçte birinden büyüktür (yükseklikte %35, genişlikte %72); GTA 6'da yürüyen karakterin tişörtü ya da sokaktaki tabela
 * o alana girince altyazı bloğu seçiliyor, ekranda altyazı yokken tek başına çevriliyordu (X bildirimleri, beta.73).
 * Altyazı bloğu seçilirken ([Reading.subtitleBlock]) şu bloklar atılır; konuşan adı taşıyan blok hep altyazıdır:
 * - eğik satır (en az üç sözcük; perspektifli tabela: sözcüklerin dikey ortası satır boyunca tek yöne kayıyor ya da
 *   satır kutusu sözcük boyunun [TILTED_LINE_HEIGHT] katından yüksek),
 * - düşük güvenli kısa blok (en çok [LOW_CONFIDENCE_WORDS] sözcük, ortalama güven [LOW_CONFIDENCE]'tan az),
 * - karenin ortasındaki kısa, noktalamasız tek satır (en çok üç sözcük; altyazı ve görev satırı karenin alt ya da üst
 *   kenarına yakındır, [EDGE_BAND]).
 * Mac/iPhone (SceneText.swift) ve Windows (SceneText.cs) aynı kuralları ve eşikleri uygular; ortak deneme dosyası
 * fixtures/scene-text.json (core/Tests/CouchSubsCoreTests/Fixtures kopyası).
 */
object SceneText {
    /** Sözcüklerin dikey ortası ilk sözcükten sonuncuya bu kadar sözcük boyu kayarsa satır eğiktir. */
    const val TILT_SHIFT = 0.6
    /** Satır kutusu sözcüklerin ortanca boyunun bu katından yüksekse satır eğiktir. */
    const val TILTED_LINE_HEIGHT = 1.8
    const val LOW_CONFIDENCE = 0.4
    const val LOW_CONFIDENCE_WORDS = 5
    /** Kısa ve noktalamasız tek satır en çok bu kadar sözcüktür. */
    const val SHORT_WORDS = 3
    /** Karenin alt ve üst kenarından bu kadarı (karenin yüksekliğine oranla) altyazı şerididir. */
    const val EDGE_BAND = 0.22

    /** [block] bir sahne yazısı mı. Satır kutuları [area]'ya oranlıdır; [area] okunan alanın karedeki yeridir. */
    fun isSceneText(block: Reading, area: TextBox): Boolean {
        val first = block.lines.firstOrNull() ?: return false
        if (SpeakerPrefix.split(first.text) != null || block.lines.any { it.box == null }) return false
        if (block.lines.any { isTilted(it) }) return true
        val words = wordCount(block.text)
        val confidences = block.lines.mapNotNull { it.confidence?.toDouble() }
        if (confidences.isNotEmpty() && confidences.average() < LOW_CONFIDENCE && words <= LOW_CONFIDENCE_WORDS) return true
        if (block.lines.size == 1 && words <= SHORT_WORDS && !looksSpoken(first.text)) {
            val placed = first.box!!.placedIn(area)
            val middle = (placed.top + placed.bottom) / 2
            return middle > EDGE_BAND && middle < 1 - EDGE_BAND
        }
        return false
    }

    /** Sözcük yerleri biliniyorsa satır eğik mi (perspektifli tabela, yan duran tişört). Altyazı yatay yazılır. */
    internal fun isTilted(line: TextLine): Boolean {
        val words = line.words ?: return false
        val box = line.box ?: return false
        if (words.size < 3) return false
        val heights = words.map { it.box.bottom - it.box.top }.sorted()
        val median = heights[heights.size / 2]
        if (median <= 0) return false
        if (box.bottom - box.top > TILTED_LINE_HEIGHT * median) return true
        val middles = words.sortedBy { it.box.left }.map { (it.box.top + it.box.bottom) / 2 }
        val shift = middles.last() - middles.first()
        if (abs(shift) <= TILT_SHIFT * median) return false
        // Tek yöne kayma: aradaki sözcükler geri dönmez (yazı tanımanın kutu oynaması sözcük boyunun %15'i kadar).
        val direction = if (shift > 0) 1.0 else -1.0
        return middles.zipWithNext().all { (a, b) -> (b - a) * direction >= -0.15 * median }
    }

    /** Konuşma izi: cümle sonu noktalaması, virgül, noktalı virgül ya da tırnak. */
    private fun looksSpoken(text: String) = SubtitleStabilizer.endsSentence(text) || text.any { it in ",;\"“”" }

    private fun wordCount(text: String) = text.split(Regex("\\s+")).count { word -> word.any { it.isLetter() } }
}
