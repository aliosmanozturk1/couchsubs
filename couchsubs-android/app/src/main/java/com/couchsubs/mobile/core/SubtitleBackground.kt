// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import kotlin.math.abs

/**
 * GTA 6'nın koyu lacivert altyazı zemini ("Altyazı zeminini izle"). OCR satırının arkasındaki rengi sınar; panel kenarı
 * aranmaz (Mac/iPhone SubtitleBackground.swift, Windows SubtitleBackground.cs ile aynı kurallar).
 */
object SubtitleBackground {
    private val verticalSamples = doubleArrayOf(-0.30, -0.15, 0.10, 0.90, 1.15, 1.30)
    private const val HORIZONTAL_SAMPLES = 9

    /**
     * Yalnız altyazı zemininin üstündeki OCR satırlarını bırakır. [color]: okunan alanın (x, y) pikselinin rengi
     * (0xRRGGBB). Kare renk taşımıyorsa (null) zemin sınanamaz; okuma olduğu gibi kalır.
     */
    fun filter(reading: Reading, width: Int, height: Int, color: ((Int, Int) -> Int)?): Reading {
        if (color == null) return reading
        return Reading(reading.lines.filter { line -> line.box?.let { hasBackground(width, height, it, color) } ?: false })
    }

    /** RGBA piksel dizisiyle (satır satır, üstten) aynı sınama. */
    fun filter(reading: Reading, pixels: ByteArray, width: Int, height: Int): Reading {
        if (width <= 0 || height <= 0 || pixels.size < width * height * 4) return Reading.Empty
        return filter(reading, width, height) { x, y ->
            val i = (y * width + x) * 4
            ((pixels[i].toInt() and 0xff) shl 16) or ((pixels[i + 1].toInt() and 0xff) shl 8) or (pixels[i + 2].toInt() and 0xff)
        }
    }

    /** Satırın hemen üstü, içi ve altındaki yatay örnekler aynı lacivert zemini taşıyor mu? */
    fun hasBackground(width: Int, height: Int, box: TextBox, color: (Int, Int) -> Int): Boolean {
        if (width <= 0 || height <= 0 || box.right <= box.left || box.bottom <= box.top) return false
        val lineHeight = box.bottom - box.top
        var bestRow = 0
        var total = 0
        for (offset in verticalSamples) {
            val y = box.top + lineHeight * offset
            if (y < 0 || y >= 1) continue
            val py = (y * height).toInt().coerceIn(0, height - 1)
            var matches = 0
            for (sample in 0 until HORIZONTAL_SAMPLES) {
                val x = box.left + (box.right - box.left) * (sample + 0.5) / HORIZONTAL_SAMPLES
                val px = (x * width).toInt().coerceIn(0, width - 1)
                val c = color(px, py)
                if (isPanelColor((c shr 16) and 0xff, (c shr 8) and 0xff, c and 0xff)) matches++
            }
            bestRow = maxOf(bestRow, matches)
            total += matches
        }
        return bestRow >= 7 && total >= 18
    }

    /**
     * Görüntüde ölçülen yaklaşık #21212E; Mac'te #3D3D51'e kadar açık gelebiliyor (#534). Sabit renk yerine kanallar
     * arası ilişki sınanır: kırmızı ile yeşil yakın, mavi biraz önde (az doygun lacivert), parlaklık geniş aralıkta.
     * Nötr gri, beyaz/sarı yazı ve doygun mavi (gece göğü, deniz) panel sayılmaz.
     */
    fun isPanelColor(red: Int, green: Int, blue: Int): Boolean {
        val brightest = maxOf(red, green)
        if (brightest !in 14..100 || minOf(red, green) < 10 || abs(red - green) > maxOf(12, brightest / 5)) return false
        val lift = blue - brightest
        return lift >= maxOf(4, brightest / 10) && lift <= maxOf(30, brightest / 2)
    }

    /**
     * Aynı OCR okuması yeniden kullanılırken zeminin izlenmesi: değişmeyen karede yazı tanıma yeniden çalışmaz, yalnız
     * eski satırların zemini yeniden sınanır (Mac/iPhone ve Windows SubtitlePipeline'daki `lastPanelReading`).
     */
    class Watch {
        class Step(val visible: Reading, val panelLeft: Boolean)

        private var panel = Reading.Empty

        /**
         * [cached] okuması yeniden kullanılacak. Zemin daha önce görünmeyen bir satırın altına geldiyse null döner:
         * kare yeniden okunmalı (eski HUD yazısı diyalog sanılmasın). [Step.panelLeft]: aynı satırlar sınandı ve zemin
         * artık yok; bu boşluk bir OCR kaçağı değildir.
         */
        fun reuse(cached: Reading, filter: (Reading) -> Reading): Step? {
            var visible = Reading.Empty
            var left = false
            if (cached.lines.any { it.box != null }) {
                visible = filter(cached)
                if (!visible.lines.all { it in panel.lines }) return null
                left = panel.lines.isNotEmpty() && visible.lines.isEmpty()
            }
            panel = visible
            return Step(visible, left)
        }

        /** Yeni okumanın zemin üstündeki satırları. */
        fun read(ocr: Reading, filter: (Reading) -> Reading): Reading = filter(ocr).also { panel = it }

        fun reset() {
            panel = Reading.Empty
        }
    }
}
