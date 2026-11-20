// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import java.util.Locale
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow

/**
 * Oyun telefonunun ekranını eğikliği giderilmiş (düz) okur. Düz koordinatlar gruplama için saklanır ([TextLine.phoneBox]),
 * çizim için karedeki gerçek yer döner (Mac/iPhone GamePhoneReader.swift, Windows GamePhoneReader.cs).
 */
object GamePhoneReader {
    /** Düzleştirilmiş telefon ekranı: yazı tanımaya giden gri NV21 görüntü (renk düzlemleri nötr). */
    class Flat(val nv21: ByteArray, val width: Int, val height: Int)

    /** Telefon ekranının (düz koordinat 0–1) karedeki yeri; eğik telefonda ekran paralelkenardır. */
    private class Warp(width: Int, height: Int, pose: GamePhoneGeometry.Pose) {
        private val topX = pose.topX * width
        private val topY = pose.topY * height
        private val dx = (pose.bottomX - pose.topX) * width
        val dy = (pose.bottomY - pose.topY) * height

        fun x(u: Double, v: Double): Double = topX + dx * (0.04 + 0.915 * v) + (u - 0.5) * 0.52 * dy
        fun y(u: Double, v: Double): Double = topY + dy * (0.04 + 0.915 * v) - (u - 0.5) * 0.52 * dx * (0.52 + v * 0.30)

        /** Kutunun dört köşesinin karedeki sınır dikdörtgeni: sol, üst, sağ, alt (piksel). */
        fun rect(box: TextBox): DoubleArray {
            val xs = doubleArrayOf(x(box.left, box.top), x(box.right, box.top), x(box.left, box.bottom), x(box.right, box.bottom))
            val ys = doubleArrayOf(y(box.left, box.top), y(box.right, box.top), y(box.left, box.bottom), y(box.right, box.bottom))
            return doubleArrayOf(xs.min(), ys.min(), xs.max(), ys.max())
        }
    }

    private val wholeScreen = TextBox(0.0, 0.0, 1.0, 1.0)

    /** Okunacak telefon ekranının karedeki sınır dikdörtgeni (sol, üst, sağ, alt; piksel): kare kopyalanırken bu kadarı alınır. */
    fun screenRect(width: Int, height: Int, pose: GamePhoneGeometry.Pose): DoubleArray = Warp(width, height, pose).rect(wholeScreen)

    fun read(frame: PhoneImage, region: CropRegion, pose: GamePhoneGeometry.Pose, reader: (Flat) -> Reading): Reading {
        val warp = Warp(frame.width, frame.height, pose)
        val dy = warp.dy
        if (!(dy > 0 && region.right > region.left && region.bottom > region.top)) return Reading.Empty
        fun pointX(u: Double, v: Double): Double = warp.x(u, v)
        fun pointY(u: Double, v: Double): Double = warp.y(u, v)
        fun rect(box: TextBox): DoubleArray = warp.rect(box)
        val whole = rect(wholeScreen)
        val x0 = floor(whole[0] - 2).toInt().coerceAtLeast(0)
        val y0 = floor(whole[1] - 2).toInt().coerceAtLeast(0)
        val pw = ceil(whole[2] + 2).toInt().coerceAtMost(frame.width) - x0
        val ph = ceil(whole[3] + 2).toInt().coerceAtMost(frame.height) - y0
        if (pw <= 0 || ph <= 0) return Reading.Empty
        val scale = minOf(if (dy * 0.5 < 300) 1.5 else 1.0, 960 / (dy * 0.9))
        // NV21 çift en ve boy ister.
        val width = maxOf(2, Math.rint(dy * 0.5 * scale).toInt() and 1.inv())
        val height = maxOf(2, Math.rint(dy * 0.9 * scale).toInt() and 1.inv())
        val out = ByteArray(width * height * 3 / 2)
        java.util.Arrays.fill(out, width * height, out.size, 128.toByte())
        fun gray(x: Int, y: Int): Int = frame.tone(x0 + x, y0 + y) shr 8
        for (y in 0 until height) {
            val v = (y + 0.5) / height
            val leftX = pointX(0.0, v)
            val leftY = pointY(0.0, v)
            val stepX = (pointX(1.0, v) - leftX) / width
            val stepY = (pointY(1.0, v) - leftY) / width
            var sx = leftX + stepX * 0.5 - 0.5
            var sy = leftY + stepY * 0.5 - 0.5
            for (x in 0 until width) {
                val px = (sx - x0).coerceIn(0.0, (pw - 1).toDouble())
                val py = (sy - y0).coerceIn(0.0, (ph - 1).toDouble())
                val ix = px.toInt()
                val iy = py.toInt()
                val wx = ((px - ix) * 256).toInt()
                val wy = ((py - iy) * 256).toInt()
                val nx = if (ix + 1 < pw) ix + 1 else ix
                val ny = if (iy + 1 < ph) iy + 1 else iy
                val upper = gray(ix, iy) * (256 - wx) + gray(nx, iy) * wx
                val lower = gray(ix, ny) * (256 - wx) + gray(nx, ny) * wx
                out[y * width + x] = ((upper * (256 - wy) + lower * wy + 32768) shr 16).toByte()
                sx += stepX
                sy += stepY
            }
        }
        fun map(box: TextBox): TextBox {
            val q = rect(box)
            fun x(n: Double) = ((n / frame.width - region.left) / (region.right - region.left)).coerceIn(0.0, 1.0)
            fun y(n: Double) = ((n / frame.height - region.top) / (region.bottom - region.top)).coerceIn(0.0, 1.0)
            return TextBox(x(q[0]), y(q[1]), x(q[2]), y(q[3]))
        }
        return Reading(reader(Flat(out, width, height)).lines.map { original ->
            original.copy(
                phoneBox = original.box, box = original.box?.let(::map),
                words = original.words?.map { TextWord(it.text, map(it.box)) },
                icons = original.icons?.map { IconSlot(map(it.box), it.text, it.image) },
            )
        })
    }
}

/** Telefon balonunun zemin ve yazı rengi (Mac/iPhone GamePhonePalette.swift, Windows GamePhonePalette.cs). */
object GamePhonePalette {
    val neutral = TextSurface(background = "#24272A", foreground = "#FFFFFF")

    private class RGB(val r: Int, val g: Int, val b: Int) {
        val tone: Int get() = 77 * r + 150 * g + 29 * b
        fun near(other: RGB, tolerance: Int) =
            abs(r - other.r) <= tolerance && abs(g - other.g) <= tolerance && abs(b - other.b) <= tolerance

        fun quantized(shift: Int = 0): RGB {
            fun channel(n: Int) = minOf(255, ((n + shift).coerceIn(0, 255) + 4) / 8 * 8)
            return RGB(channel(r), channel(g), channel(b))
        }

        val hex: String get() = String.format(Locale.ROOT, "#%02X%02X%02X", r, g, b)
        val luminance: Double
            get() {
                fun linear(n: Int): Double {
                    val s = n / 255.0
                    return if (s <= 0.04045) s / 12.92 else ((s + 0.055) / 1.055).pow(2.4)
                }
                return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
            }

        fun contrast(other: RGB): Double {
            val a = luminance
            val b = other.luminance
            return (maxOf(a, b) + 0.05) / (minOf(a, b) + 0.05)
        }
    }

    /** [box]: balonun karedeki yeri, kenarlara oranla. Renkler kutunun içindeki 45 örnekten çıkarılır. */
    fun sample(frame: PhoneImage, box: TextBox): TextSurface {
        val rect = PhoneRect.of(box, frame) ?: return neutral
        if (rect.width < 3 || rect.height < 2) return neutral
        var colors = ArrayList<RGB>(45)
        for (row in 0 until 5) {
            val y = (2 * row + 1) * rect.height / 10
            for (col in 0 until 9) {
                val x = (4 * col + 1 + 2 * (row % 2)) * rect.width / 36
                val c = frame.rgb(rect.x + x, rect.y + y)
                colors.add(RGB((c shr 16) and 0xff, (c shr 8) and 0xff, c and 0xff))
            }
        }
        var center = colors[0]
        var most = 0
        for (candidate in colors) {
            val count = colors.count { candidate.near(it, 20) }
            if (count > most) {
                most = count
                center = candidate
            }
        }
        if (most * 100 < colors.size * 45) return neutral
        var r = 0
        var g = 0
        var b = 0
        for (pixel in colors) if (center.near(pixel, 20)) {
            r += pixel.r
            g += pixel.g
            b += pixel.b
        }
        val surface = RGB(r / most, g / most, b / most)
        colors = ArrayList(colors.sortedBy { it.tone })
        val dark = colors[2]
        val light = colors[colors.size - 3]
        val ink = if (surface.tone - dark.tone > light.tone - surface.tone) dark else light
        if (most * 5 < colors.size * 3 && !twoColorSurface(colors, surface, ink)) return neutral
        var background = surface.quantized()
        var foreground = ink.quantized()
        val black = RGB(0, 0, 0)
        val white = RGB(255, 255, 255)
        if (colors.count { ink.near(it, 24) } < 3 || background.contrast(foreground) < 4.5) {
            val lightInk = ink.tone > surface.tone
            foreground = if (lightInk) white else black
            if (background.contrast(foreground) < 4.5) {
                val adjusted = surface.quantized(if (lightInk) -8 else 8)
                if (adjusted.contrast(foreground) >= 4.5) background = adjusted
                else foreground = if (lightInk) black else white
            }
        }
        return TextSurface(background = background.hex, foreground = foreground.hex)
    }

    private fun twoColorSurface(colors: List<RGB>, surface: RGB, ink: RGB): Boolean {
        val r = ink.r - surface.r
        val g = ink.g - surface.g
        val b = ink.b - surface.b
        val length = r * r + g * g + b * b
        if (length <= 0) return false
        val matching = colors.count { c ->
            val cr = c.r - surface.r
            val cg = c.g - surface.g
            val cb = c.b - surface.b
            val t = ((cr * r + cg * g + cb * b).toDouble() / length).coerceIn(0.0, 1.0)
            abs(cr - t * r) <= 24 && abs(cg - t * g) <= 24 && abs(cb - t * b) <= 24
        }
        return matching * 5 >= colors.size * 4
    }
}

/** Kutunun karedeki piksel dikdörtgeni: tam piksele genişletilmiş ve kareyle kesiştirilmiş hâli ([x], [y], [width], [height]). */
internal class PhoneRect(val left: Double, val top: Double, val w: Double, val h: Double, val x: Int, val y: Int, val width: Int, val height: Int) {
    /** Dikdörtgenin içine sıkıştırılmış piksel; (px, py) kare koordinatıdır. */
    fun clampX(px: Int) = px.coerceIn(x, x + width - 1)
    fun clampY(py: Int) = py.coerceIn(y, y + height - 1)

    companion object {
        fun of(box: TextBox, frame: PhoneImage): PhoneRect? {
            val left = box.left * frame.width
            val top = box.top * frame.height
            val w = (box.right - box.left) * frame.width
            val h = (box.bottom - box.top) * frame.height
            if (!(w > 0 && h > 0)) return null
            val x = floor(left).toInt().coerceAtLeast(0)
            val y = floor(top).toInt().coerceAtLeast(0)
            val width = ceil(left + w).toInt().coerceAtMost(frame.width) - x
            val height = ceil(top + h).toInt().coerceAtMost(frame.height) - y
            return if (width > 0 && height > 0) PhoneRect(left, top, w, h, x, y, width, height) else null
        }
    }
}

/**
 * Telefon sayfasının izi: telefonun arkasında oynayan görüntü yerine harflerin kendisi örneklenir; çeviri beklerken de
 * sayfanın değişip değişmediği buradan anlaşılır (Mac/iPhone GamePhonePage.swift, Windows GamePhonePage.cs).
 */
class GamePhonePage(frame: PhoneImage, region: CropRegion, reading: Reading) {
    private class Patch(val box: TextBox, val columns: Int, val rows: Int, val samples: IntArray)

    private val patches: List<Patch>

    init {
        val place = region.box
        var boxes = reading.lines.mapNotNull { it.box }
        if (boxes.isEmpty()) boxes = listOf(TextBox(0.0, 0.0, 1.0, 1.0))
        patches = boxes.mapNotNull { relative ->
            val rect = PhoneRect.of(relative.placedIn(place), frame) ?: return@mapNotNull null
            val columns = ceil(rect.w).toInt().coerceIn(1, 128)
            val rows = ceil(rect.h).toInt().coerceIn(1, 12)
            val samples = IntArray(rows * columns)
            for (row in 0 until rows) for (column in 0 until columns) {
                samples[row * columns + column] = tone(frame, rect, column, row, columns, rows)
            }
            Patch(relative, columns, rows, samples)
        }
    }

    fun changed(frame: PhoneImage, region: CropRegion): Boolean {
        if (patches.isEmpty()) return true
        val place = region.box
        for (patch in patches) {
            val rect = PhoneRect.of(patch.box.placedIn(place), frame) ?: return true
            var first: Long? = null
            for (row in 0 until patch.rows) for (col in 0 until patch.columns) {
                val delta = tone(frame, rect, col, row, patch.columns, patch.rows) - patch.samples[row * patch.columns + col]
                if (abs(delta) > RegionSignature.CHANGE_THRESHOLD) {
                    val p = pixel(rect, col, row, patch.columns, patch.rows)
                    // Tek pikselin oynaması sıkıştırma gürültüsüdür; iki ayrı piksel değiştiyse sayfa değişmiştir.
                    if (first != null && first != p) return true
                    first = p
                }
            }
        }
        return false
    }

    private fun pixelX(rect: PhoneRect, col: Int, cols: Int) = rect.clampX((rect.left + (col + 0.5) * rect.w / cols).toInt())
    private fun pixelY(rect: PhoneRect, row: Int, rows: Int) = rect.clampY((rect.top + (row + 0.5) * rect.h / rows).toInt())
    private fun pixel(rect: PhoneRect, col: Int, row: Int, cols: Int, rows: Int): Long =
        pixelY(rect, row, rows).toLong() * 1_000_000 + pixelX(rect, col, cols)

    private fun tone(frame: PhoneImage, rect: PhoneRect, col: Int, row: Int, cols: Int, rows: Int): Int {
        val c = frame.rgb(pixelX(rect, col, cols), pixelY(rect, row, rows))
        return (((c shr 16) and 0xff) + 2 * ((c shr 8) and 0xff) + (c and 0xff)) / 4
    }
}
