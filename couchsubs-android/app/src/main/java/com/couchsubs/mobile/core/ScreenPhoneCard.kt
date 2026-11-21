// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

/**
 * "Ekranı çevir"de GTA 6 telefonu: eğik telefon ekranının üstüne yazmak okunmuyordu (yazı küçük, ekran yamuk). Telefon
 * karede bulunursa ([GamePhoneGeometry]) içindeki yazıların çevirisi telefonun hemen yanına, ekranda yer olan tarafa,
 * telefon boyunda açık renkli bir "mesaj kartı" olarak dizilir: en üstte kişi adı, altında her mesaj kendi balonunda,
 * okunan balonun yüksekliğinde. Telefonun sağ yarısına yaslı balon giden mesajdır (sağda, mavi), diğerleri gelen (solda,
 * beyaz). Telefon dışındaki yazılar kendi yerlerinde kalır. Kart TV'ye ve telefona sıradan stilli öğeler olarak gider
 * (zemin, başlık, balonlar), ayrı bir çizim gerekmez (Mac/iPhone: ScreenPhoneCard.swift, Windows: ScreenPhoneCard.cs).
 */
object ScreenPhoneCard {
    /** Kartın zemini: yazısı yalnız bölünmez boşluk olan öğe, kartın tamamını kaplar; balonlar üstüne çizilir. */
    const val BACKDROP_TEXT = " "
    val CARD = TextSurface("#F2F2F7", "#1C1C1E")
    val INCOMING = TextSurface("#FFFFFF", "#1C1C1E")
    val OUTGOING = TextSurface("#0A84FF", "#FFFFFF")
    /** Telefonla kart arasındaki boşluk ve kartın ekran kenarından payı (ekran genişliğine oranla). */
    const val GAP = 0.008
    /** Kart için yanda en az bu kadar yer olmalı; yoksa çeviriler telefonun üstünde kalır. */
    const val MIN_WIDTH = 0.12
    /** Balonun kart genişliğine oranı. */
    const val BUBBLE_SHARE = 0.8

    /** Öğe kartın zemini mi (düz metin bunu atlar). */
    fun isBackdrop(item: ScreenTranslation.Item): Boolean = item.translation.isBlank()

    /** Okunan karede telefon varsa yeri (kenarlara oranla); akla yatkın olmayan aday yok sayılır. */
    fun phone(image: PhoneImage): TextBox? {
        val bounds = GamePhoneGeometry.locate(image)?.bounds ?: return null
        if (!GamePhoneTracker.plausible(bounds, image.width, image.height)) return null
        return TextBox(bounds.left, bounds.top, bounds.right, bounds.bottom)
    }

    /**
     * Telefondaki öğeleri kart olarak dizer. Telefonda çevrilmiş öğe yoksa ya da yanda yer yoksa liste olduğu gibi döner.
     * Çevrilmemiş öğeler ([ScreenTranslation.Item.unchanged]: kişi adı, "ok") kartta aslıyla görünür; kart dışındakiler
     * sonra atılır.
     */
    fun layout(items: List<ScreenTranslation.Item>, phone: TextBox): List<ScreenTranslation.Item> {
        fun inside(box: TextBox): Boolean {
            val x = (box.left + box.right) / 2
            val y = (box.top + box.bottom) / 2
            return x >= phone.left && x <= phone.right && y >= phone.top && y <= phone.bottom
        }
        val onPhone = items.filter { inside(it.box) }.sortedBy { it.box.top }
        if (onPhone.none { !it.unchanged }) return items
        val phoneWidth = phone.right - phone.left
        val roomLeft = phone.left - 2 * GAP
        val roomRight = 1 - phone.right - 2 * GAP
        val onLeft = roomLeft >= roomRight
        val width = minOf(maxOf(phoneWidth, MIN_WIDTH), maxOf(roomLeft, roomRight))
        if (width < MIN_WIDTH) return items
        val left = if (onLeft) phone.left - GAP - width else phone.right + GAP
        val card = TextBox(left, phone.top, left + width, phone.bottom)
        val pad = width * 0.05
        fun flat(align: String, bold: Boolean) = TextLook(bold, false, align, false)

        val result = items.filter { !inside(it.box) }.toMutableList()
        result.add(ScreenTranslation.Item("", BACKDROP_TEXT, card, onPhone.minOf { it.lineHeight }, surface = CARD, look = flat("left", false)))
        onPhone.forEachIndexed { index, item ->
            val top = maxOf(card.top, item.box.top)
            val bottom = minOf(card.bottom, maxOf(top + item.lineHeight, item.box.bottom))
            if (index == 0 && isHeader(item, phone)) {
                // Kişi adı: kartın başlığı, ortalı ve kalın; zemin kartın rengi.
                result.add(item.copy(box = TextBox(card.left + pad, top, card.right - pad, bottom), surface = CARD,
                    look = flat("center", true), unchanged = false))
                return@forEachIndexed
            }
            // Telefonun sağ kenarına sol kenarından belirgin yakın balon giden mesajdır.
            val outgoing = phone.right - item.box.right < (item.box.left - phone.left) * 0.6
            val bubble = width * BUBBLE_SHARE
            val x = if (outgoing) card.right - pad - bubble else card.left + pad
            result.add(item.copy(box = TextBox(x, top, x + bubble, bottom), surface = if (outgoing) OUTGOING else INCOMING,
                look = flat(if (outgoing) "right" else "left", false), unchanged = false))
        }
        return result
    }

    /** En üstteki kısa satır (en çok dört sözcük, tek parça) telefonun üst dörtte birindeyse kişi adıdır. */
    internal fun isHeader(item: ScreenTranslation.Item, phone: TextBox): Boolean =
        !item.source.contains('\n') && item.source.split(Regex("\\s+")).count { it.isNotEmpty() } <= 4 &&
            item.box.top < phone.top + (phone.bottom - phone.top) * 0.25
}
