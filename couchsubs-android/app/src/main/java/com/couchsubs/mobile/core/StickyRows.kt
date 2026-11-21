// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

/**
 * Konuşma değişirken ekranda sabit duran satırı (görev/HUD yazısı) okumadan çıkarır. GTA 6'da görev yazısı ("Get in
 * the sea plane") konuşma altyazısının hemen altında dakikalarca durur; yazı tanıma ikisini tek blok okuyordu. Konuşma
 * kalkıp görev tek başına kalınca kararlayıcı bunu gönderilenin bir satırı eksik okuması sayıyor, TV'de eski konuşmanın
 * çevirisi kalıyordu; kısa yeni konuşma da uzun görev satırı yüzünden aynı altyazı sayılıp çevrilmiyordu. Bir satır en
 * az [STICKY_MS] ekranda kaldıysa ve yanında ondan en az [YOUNGER_BY_MS] sonra gelmiş başka bir satır varsa sabit
 * sayılır; sabit satır, ekrandan kalkana dek (tek başına kalsa da) okumadan çıkarılır. Satırları birlikte beliren
 * konuşma kutusu etkilenmez (Mac: StickyRows.swift, Windows: StickyRows.cs).
 */
class StickyRows {
    companion object {
        /** Satır bu kadar ekranda kalmadan sabit sayılmaz. */
        const val STICKY_MS = 6000L
        /** Yanındaki satırın en az bu kadar sonra gelmiş olması gerekir (birlikte beliren satırlar konuşmadır). */
        const val YOUNGER_BY_MS = 3000L
        /** Bu kadar okunmayan satır ekrandan kalkmış sayılır (birkaç karelik okuma kaçağı satırı unutturmaz). */
        const val FORGET_AFTER_MS = 1500L
        /**
         * Görev satırı henüz sabit sayılmadan da (ilk [STICKY_MS]) altyazıya karışmasın: okumanın üst ya da alt ucunda
         * duran, yanındaki en yeni satırdan en az bu kadar önce gelmiş, konuşan adı taşımayan satır bu okumadan çıkarılır.
         * Kullanıcı bildirimi (GTA 6): görev yazısı ("x yere git") ekrandayken gelen altyazılar ya görevle tek blok
         * gönderiliyor ya da görev ayrı blok olarak altyazının yerine seçiliyordu; arada diyaloglar kayboluyordu. Yazı
         * yazılır gibi beliren ikinci satır (yaklaşık 1 sn sonra) bu süreden kısa kalır, konuşma bölünmez. Yaş satırın son
         * büyümesinden sayılır (yazı yazılır gibi beliren üst satır alt satır gelene dek büyür) ve üst uçtaki satırın
         * altındaki satır onun devamıysa ([Reading.continues]: cümle bitmemiş, alttaki küçük harfle başlıyor ya da kısa)
         * üst satır çıkarılmaz: iki satırlı altyazının alt satırı geç belirince üst satır atılıyor, yalnız alttaki 1-2
         * sözcük çevriliyordu (GitHub #715).
         */
        const val LINGER_MS = 1200L
        /**
         * Eklenen satır görev sayılmak için ekrandaki en uzun satırın en çok bu kadarı olmalı (görev kısa: "Follow
         * John"); boyları yakınsa hangisinin görev olduğu bilinmez, eski kural uygulanır.
         */
        const val JOINED_SHARE = 0.8
    }

    private class Row(var text: String, val since: Long) {
        var lastSeen = since
        /** Satırın en son büyüdüğü an (yazı yazılır gibi beliren satır). */
        var grown = since
        var sticky = false
        /**
         * Satır, önceki okumanın satırları (en az [LINGER_MS] durgun, hiçbiri kalkmamış, konuşan adı yok) dururken
         * onların altına eklendi; konuşan adı taşımıyor, üstteki cümlenin devamı değil ve en uzun satırdan belirgin kısa
         * ([JOINED_SHARE]): eski satır değil bu satır görev yazısıdır. Yanında başka satır oldukça çıkarılır; yanındaki
         * konuşma eski sayılmaz. Kullanıcı bildirimi (X, beta.69, GTA 6): "John'u takip et" konuşma ekrandayken alta
         * çıkınca konuşma çevrilmiyordu; [LINGER_MS] kuralı konuşmayı (eski satır) görev sanıp atıyor, görevi altyazı
         * olarak gönderiyordu.
         */
        var joined = false
    }

    private val rows = mutableListOf<Row>()
    /** Önceki [filter] çağrısında okunan satırlar. */
    private var previous: List<Row> = emptyList()

    /** Son [filter] çağrısında ilk kez sabit sayılan satırlar (günlük için). */
    var newlySticky: List<String> = emptyList()
        private set

    /** Son [filter] çağrısında okumadan çıkarılan satırlar (sabit ya da uçta bekleyen; görev satırı, [MissionLine]). */
    var removed: List<TextLine> = emptyList()
        private set

    /** Okumanın sabit (HUD) satırları çıkarılmış hali. [time]: milisaniye saati. */
    fun filter(reading: Reading, time: Long): Reading {
        val newly = mutableListOf<String>()
        val matched = mutableListOf<Row?>()
        val used = mutableSetOf<Row>()
        val created = mutableListOf<Int>()
        for (line in reading.lines) {
            val text = TextMatch.normalize(line.text)
            if (text.length < 3) { matched.add(null); continue }
            val row = rows.firstOrNull { it !in used && TextMatch.isSimilar(text, it.text) }
                ?: Row(text, time).also { rows.add(it); created.add(matched.size) }
            if (text.length >= row.text.length + 3) {
                // Satır büyüdü (yazı yazılır gibi): yaşı yeniden başlar; okuma sapmaları (kısalıp uzama) saymaz.
                row.text = text
                row.grown = time
            }
            row.lastSeen = time
            used.add(row)
            matched.add(row)
        }
        val present = matched.filterNotNull()
        for (i in created) matched[i]!!.joined = joins(reading, matched, i, present, time)
        previous = present
        matched.forEachIndexed { i, row ->
            if (row == null || row.sticky || time - row.since < STICKY_MS) return@forEachIndexed
            if (present.any { it.since - row.since >= YOUNGER_BY_MS }) {
                row.sticky = true
                newly.add(reading.lines[i].text)
            }
        }
        newlySticky = newly
        val lingering = lingering(reading, matched)
        val kept = reading.lines.filterIndexed { i, _ -> matched[i]?.sticky != true && !lingering[i] }
        removed = reading.lines.filterIndexed { i, _ -> matched[i]?.sticky == true || lingering[i] }
        rows.removeAll { time - it.lastSeen > FORGET_AFTER_MS }
        return if (kept.size == reading.lines.size) reading else Reading(kept)
    }

    /**
     * Yeni satır ([index]) ekrandaki konuşmanın altına eklenen görev yazısı mı (bkz. [Row.joined]). Yazı yazılır gibi
     * beliren ikinci satır eklenmiş sayılmaz: üstteki satır az önce büyüyordu ya da yeni satır onun devamı
     * ([Reading.continues]). Konuşma değişirken gelen satır da sayılmaz: önceki satırlardan biri kalktı.
     */
    private fun joins(reading: Reading, matched: List<Row?>, index: Int, present: List<Row>, time: Long): Boolean {
        if (previous.isEmpty() || previous.any { it !in present || time - it.grown < LINGER_MS }) return false
        if (matched.drop(index + 1).any { it != null }) return false
        val line = reading.lines[index].text
        if (SpeakerPrefix.split(line) != null) return false
        // Konuşan adlı konuşmanın altına gelen satır sıradaki konuşmacının yanıtıdır ("Lucia: Wait for me." / "Okay.").
        if ((0 until index).any { matched[it] != null && SpeakerPrefix.split(reading.lines[it].text) != null }) return false
        if (matched[index]!!.text.length > JOINED_SHARE * previous.maxOf { it.text.length }) return false
        val upper = (0 until index).lastOrNull { matched[it] != null } ?: return true
        return !Reading.continues(reading.lines[upper].text, line)
    }

    /**
     * [LINGER_MS]: okumanın üst ya da alt ucundaki, en yeni satırdan en az o kadar eski satırlar (görev yazısı) ve
     * konuşmanın altına eklenen satırlar ([Row.joined]). Eklenen satır "en yeni" sayılmaz: konuşmayı eski gösterip
     * atmasın. Sabit satırlar hesaba katılmaz; konuşan adlı satır hiç çıkarılmaz.
     */
    private fun lingering(reading: Reading, matched: List<Row?>): BooleanArray {
        val result = BooleanArray(reading.lines.size)
        val live = matched.indices.filter { matched[it]?.sticky == false }
        if (live.size < 2) return result
        val settled = live.filter { !matched[it]!!.joined }
        val youngest = settled.ifEmpty { live }.maxOf { matched[it]!!.since }
        fun old(i: Int) = SpeakerPrefix.split(reading.lines[i].text) == null &&
            ((matched[i]!!.joined && settled.isNotEmpty()) || youngest - matched[i]!!.grown >= LINGER_MS)
        // Yalnız uçtaki eski satırlar (görev altyazının altında ya da üstünde); ortadaki satır konuşmanın parçasıdır.
        // Üstteki eski satırın altındaki satır onun devamıysa ikisi aynı cümledir: üst satır kalır.
        for ((k, i) in live.withIndex()) {
            if (!old(i)) break
            if (k + 1 < live.size && Reading.continues(reading.lines[i].text, reading.lines[live[k + 1]].text)) break
            result[i] = true
        }
        for (i in live.asReversed()) if (old(i)) result[i] = true else break
        return result
    }

    fun reset() {
        rows.clear()
        previous = emptyList()
        newlySticky = emptyList()
        removed = emptyList()
    }
}
