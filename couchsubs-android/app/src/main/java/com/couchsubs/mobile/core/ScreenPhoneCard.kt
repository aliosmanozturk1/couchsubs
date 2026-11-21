// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import kotlin.math.abs

/**
 * "Ekranı çevir"de GTA 6 telefonu: eğik telefon ekranının üstüne yazmak okunmuyordu (yazı küçük, ekran yamuk). Telefon
 * karede bulunursa ([GamePhoneGeometry]) ekranındaki satırlar düz ekrana taşınıp ayrı gruplanır ([PhoneChat]) ve
 * çevirileri telefonun hemen yanına, ekranda yer olan tarafa, telefon boyunda açık renkli bir "mesaj kartı" olarak
 * dizilir: en üstte kişi adı, altında her mesaj kendi balonunda (giden sağda mavi, gelen solda beyaz), sohbet listesinde
 * ad + önizleme satırları. Balonların yüksekliği Türkçenin kaç satır tutacağına göre hesaplanır, üst üste binmez; kart
 * dolarsa en eski mesajlar düşer. Yanda yer yoksa kart telefonun üstüne konur. Telefon dışındaki yazılar kendi
 * yerlerinde kalır. Kart TV'ye ve telefona sıradan stilli öğeler olarak gider (zemin, başlık, balonlar), ayrı bir çizim
 * gerekmez (Mac/iPhone: ScreenPhoneCard.swift, Windows: ScreenPhoneCard.cs; ortak deneme dosyası fixtures/phone-chat.json).
 */
object ScreenPhoneCard {
    /** Kartın zemini: yazısı yalnız bölünmez boşluk olan öğe, kartın tamamını kaplar; balonlar üstüne çizilir. */
    const val BACKDROP_TEXT = "\u00A0"
    val CARD = TextSurface("#F2F2F7", "#1C1C1E")
    val INCOMING = TextSurface("#FFFFFF", "#1C1C1E")
    val OUTGOING = TextSurface("#0A84FF", "#FFFFFF")
    /** Telefonla kart arasındaki boşluk ve kartın ekran kenarından payı (ekran genişliğine oranla). */
    const val GAP = 0.008
    /** Kart için yanda en az bu kadar yer olmalı; yoksa kart telefonun üstüne konur. */
    const val MIN_WIDTH = 0.12
    /** Balonun kart genişliğine oranı (en çok) ve en az. */
    const val BUBBLE_SHARE = 0.8
    const val BUBBLE_MIN = 0.3
    /** Kartta yazı boyu (kare yüksekliğine oranla) en az bu: telefonun küçük yazısı TV'de okunsun (1080p'de ~24 nokta). */
    const val MIN_LINE = 0.022
    /** Bir harfin ortalama genişliği, satır yüksekliğine oranla (TV'nin yazı tipinde Türkçe metinle ölçüldü, ~0,5). */
    const val CHAR_WIDTH = 0.5

    /** Telefondaki yazının kartta ne olduğu; [wire] Mac ve Windows'taki adı (ortak deneme dosyası). */
    enum class Role(val wire: String) {
        /** Sohbetin başlığı (kişi adı); çevrilmez. */
        HEADER("header"),
        /** Gelen mesaj (sola yaslı balon), giden mesaj (sağa yaslı), tarafı belirsiz mesaj (rengine bakılır). */
        INCOMING("incoming"), OUTGOING("outgoing"), MESSAGE("message"),
        /** Ortalı kısa satır: saat, "Today", "Delivered". */
        NOTE("note"),
        /** Sohbet listesi: kişi adı (çevrilmez), son mesaj önizlemesi, bölüm başlığı ("Messages"). */
        CONTACT("contact"), PREVIEW("preview"), HEADING("heading");

        /** Çevirmene gitmez, aslıyla gösterilir (ad). */
        val keepsText: Boolean get() = this == HEADER || this == CONTACT
    }

    /** Telefondaki bir grubun rolü ve düz ekrandaki yeri (0–1). */
    data class Placement(val role: Role, val spot: TextBox)

    /**
     * Karedeki telefon: sınır kutusu ve ekranın ekseni (hoparlörden alt çentiğe). Eğik telefonun ekranındaki her nokta
     * düz ekrana (u: soldan sağa, v: yukarıdan aşağı, 0–1) taşınabilir; [GamePhoneReader]'ın düzeltmesinin tersidir.
     * [aspect]: karenin genişliği / yüksekliği.
     */
    data class Handset(val pose: GamePhoneGeometry.Pose, val aspect: Double) {
        val bounds: TextBox = pose.bounds.let { TextBox(it.left, it.top, it.right, it.bottom) }

        /** Ekranın yüksekliği, kare yüksekliğine oranla. */
        val screenHeight: Double get() = (pose.bottomY - pose.topY) * 0.915

        /** Düz ekrandaki noktanın karedeki yeri (kenarlara oranla). */
        fun point(u: Double, v: Double): Pair<Double, Double> {
            val dx = pose.bottomX - pose.topX
            val dy = pose.bottomY - pose.topY
            val t = 0.04 + 0.915 * v
            val side = (u - 0.5) * 0.52
            return Pair(pose.topX + dx * t + side * dy / aspect, pose.topY + dy * t - side * dx * aspect * (0.52 + v * 0.30))
        }

        /** Karedeki noktanın düz ekrandaki yeri (Newton adımlarıyla; dönüşüm neredeyse doğrusal, dört adım yeter). */
        fun screen(x: Double, y: Double): Pair<Double, Double> {
            val dx = pose.bottomX - pose.topX
            val dy = pose.bottomY - pose.topY
            var u = 0.5
            var v = ((y - pose.topY) / dy - 0.04) / 0.915
            repeat(4) {
                val (px, py) = point(u, v)
                val ex = px - x
                val ey = py - y
                val a = 0.52 * dy / aspect
                val b = 0.915 * dx
                val c = -0.52 * dx * aspect * (0.52 + 0.30 * v)
                val d = 0.915 * dy - (u - 0.5) * 0.52 * dx * aspect * 0.30
                val det = a * d - b * c
                if (abs(det) <= 1e-12) return Pair(u, v)
                u -= (d * ex - b * ey) / det
                v -= (a * ey - c * ex) / det
            }
            return Pair(u, v)
        }

        /**
         * Karedeki satır kutusunun düz ekrandaki yeri. Eğik ekranda okunan kutu satırın eğimini de kapsar: satırın
         * gerçek yüksekliği kutunun yüksekliğinden eğimin payı düşülerek bulunur.
         */
        fun flat(box: TextBox): TextBox {
            val cx = (box.left + box.right) / 2
            val cy = (box.top + box.bottom) / 2
            val (_, cv) = screen(cx, cy)
            val dx = pose.bottomX - pose.topX
            val dy = pose.bottomY - pose.topY
            val slope = (-0.52 * dx * aspect * (0.52 + 0.30 * cv)) / (0.52 * dy / aspect)
            val left = screen(box.left, cy + slope * (box.left - cx)).first
            val right = screen(box.right, cy + slope * (box.right - cx)).first
            val height = box.bottom - box.top
            val upright = maxOf(height - abs(slope) * (box.right - box.left), height * 0.35)
            val half = upright / screenHeight / 2
            return TextBox(left, cv - half, right, cv + half)
        }

        companion object {
            /** Düz ekranın eni / boyu (telefon okuyucusunun ekran oranı: 0,52 / 0,915). */
            const val SCREEN_SHAPE = 0.52 / 0.915
        }
    }

    /** Öğe kartın zemini mi (düz metin bunu atlar). */
    fun isBackdrop(item: ScreenTranslation.Item): Boolean = item.translation.isBlank()

    /** Okunan karede telefon varsa yeri ve eğikliği; akla yatkın olmayan aday yok sayılır. */
    fun phone(image: PhoneImage): Handset? {
        val pose = GamePhoneGeometry.locate(image) ?: return null
        if (!GamePhoneTracker.plausible(pose.bounds, image.width, image.height)) return null
        return Handset(pose, image.width.toDouble() / maxOf(1, image.height))
    }

    /** Kartın yeri: telefonun daha geniş boş kalan yanında, telefon boyunda; iki yanda da yer yoksa telefonun üstünde. */
    internal fun cardBox(phone: TextBox): TextBox {
        val roomLeft = phone.left - 2 * GAP
        val roomRight = 1 - phone.right - 2 * GAP
        val width = minOf(maxOf(phone.right - phone.left, MIN_WIDTH), maxOf(roomLeft, roomRight))
        if (width < MIN_WIDTH) return TextBox(maxOf(0.0, phone.left), phone.top, minOf(1.0, phone.right), phone.bottom)
        val left = if (roomLeft >= roomRight) phone.left - GAP - width else phone.right + GAP
        return TextBox(left, phone.top, left + width, phone.bottom)
    }

    private class Row(val item: ScreenTranslation.Item, val width: Double, val height: Double, val side: String)

    /**
     * Telefondaki öğeleri (`phone` bilgisi olanlar) kart olarak dizer. Telefonda çevrilmiş öğe yoksa liste olduğu gibi
     * döner. Çevrilmemiş öğeler ([ScreenTranslation.Item.unchanged]: kişi adı, "ok") kartta aslıyla görünür; kart
     * dışındakiler sonra atılır.
     */
    fun layout(items: List<ScreenTranslation.Item>, handset: Handset): List<ScreenTranslation.Item> {
        val onPhone = items.filter { it.phone != null }.sortedBy { it.phone!!.spot.top }
        if (onPhone.none { !it.unchanged }) return items
        val card = cardBox(handset.bounds)
        val cardWidth = card.right - card.left
        val heights = onPhone.map { it.lineHeight }.sorted()
        val line = maxOf(MIN_LINE, heights[heights.size / 2])
        val pad = cardWidth * 0.05
        val padY = line * 0.4
        val spacing = line * 0.35
        fun flat(align: String, bold: Boolean) = TextLook(bold, false, align, false)

        val result = items.filter { it.phone == null }.toMutableList()
        result.add(ScreenTranslation.Item("", BACKDROP_TEXT, card, line, surface = CARD, look = flat("left", false)))

        var bodyTop = card.top + padY
        var body = onPhone
        val first = body.first()
        if (first.phone?.role == Role.HEADER) {
            val header = first.copy(box = TextBox(card.left + pad, bodyTop, card.right - pad, bodyTop + line * 1.4), lineHeight = line,
                surface = CARD, look = flat("center", true), unchanged = false)
            result.add(header)
            bodyTop = header.box.bottom + spacing
            body = body.drop(1)
        }

        // Her satırın kartta kaplayacağı yer: genişliği rolünden, yüksekliği Türkçenin o genişlikte kaç satır tuttuğundan.
        val rows = body.map { item ->
            val given = item.phone!!.role
            val role = if (given == Role.MESSAGE) (if (isBlue(item.surface)) Role.OUTGOING else Role.INCOMING) else given
            val bubble = role == Role.INCOMING || role == Role.OUTGOING
            val widest = (if (bubble) BUBBLE_SHARE else 1.0) * cardWidth - (if (bubble) 0.0 else 2 * pad)
            val inner = widest - 2 * pad
            val lines = wrap(item.translation, (inner * handset.aspect / (line * CHAR_WIDTH)).toInt())
            val longest = (lines.maxOfOrNull { it.length } ?: 0) * line * CHAR_WIDTH / handset.aspect + 2 * pad
            val width = if (bubble) minOf(widest, maxOf(cardWidth * BUBBLE_MIN, longest)) else widest
            val surface = when (role) {
                Role.OUTGOING -> OUTGOING
                Role.INCOMING -> INCOMING
                else -> CARD
            }
            val side = if (role == Role.OUTGOING) "right" else if (role == Role.NOTE) "center" else "left"
            val placed = item.copy(unchanged = false, lineHeight = line, surface = surface,
                look = flat(side, role == Role.CONTACT || role == Role.HEADING))
            Row(placed, width, lines.size * line * 1.25 + padY, side)
        }.toMutableList()
        // Kart dolarsa en eski (en üstteki) satırlar düşer: son mesajlar görünür kalır.
        val limit = card.bottom - padY
        while (rows.size > 1 && rows.sumOf { it.height } + spacing * (rows.size - 1) > limit - bodyTop) rows.removeAt(0)
        // Önce telefondaki yerine (oranla) yakın, üsttekinin altında; taşan satırlar alttan yukarı itilir.
        val tops = DoubleArray(rows.size)
        var cursor = bodyTop
        rows.forEachIndexed { index, row ->
            val wanted = card.top + row.item.phone!!.spot.top * (card.bottom - card.top)
            tops[index] = maxOf(wanted, cursor)
            cursor = tops[index] + row.height + spacing
        }
        var floor = limit
        for (index in rows.indices.reversed()) {
            tops[index] = maxOf(bodyTop, minOf(tops[index], floor - rows[index].height))
            floor = tops[index] - spacing
        }
        rows.forEachIndexed { index, row ->
            val left = when (row.side) {
                "right" -> card.right - pad - row.width
                "center" -> (card.left + card.right - row.width) / 2
                else -> card.left + pad
            }
            result.add(row.item.copy(box = TextBox(left, tops[index], left + row.width, tops[index] + row.height)))
        }
        return result
    }

    /** Metni sözcük sözcük en çok [perLine] harflik satırlara böler (çok uzun sözcük kendi satırında kalır). */
    internal fun wrap(text: String, perLine: Int): List<String> {
        val limit = maxOf(4, perLine)
        val lines = mutableListOf<String>()
        for (paragraph in text.split('\n')) {
            var current = ""
            for (word in paragraph.split(Regex("\\s+")).filter { it.isNotEmpty() }) {
                if (current.isEmpty()) current = word
                else if (current.length + 1 + word.length <= limit) current += " $word"
                else {
                    lines.add(current)
                    current = word
                }
            }
            lines.add(current)
        }
        return lines
    }

    /** Balonun okunan rengi belirgin mavi mi (giden mesaj balonu): mavi kanal kırmızı ve yeşilin ortalamasından en az 40 fazla. */
    internal fun isBlue(surface: TextSurface?): Boolean {
        val hex = surface?.background ?: return false
        if (hex.length != 7 || !hex.startsWith("#")) return false
        val value = hex.substring(1).toIntOrNull(16) ?: return false
        val r = (value shr 16) and 0xFF
        val g = (value shr 8) and 0xFF
        val b = value and 0xFF
        return b - (r + g) / 2 >= 40
    }
}
