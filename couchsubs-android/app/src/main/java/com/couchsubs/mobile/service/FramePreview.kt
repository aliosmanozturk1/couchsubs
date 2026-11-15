// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.service

import android.graphics.Bitmap
import android.media.Image
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * Son PS5 karesinin küçük gri kopyası: Ayarlar › Altyazı alanındaki canlı önizleme (iPhone'daki PhoneFramePreview).
 * Yalnız önizleme açıkken ([watch]) ve saniyede bir kopyalanır; çeviri hattını yavaşlatmaz.
 */
object FramePreview {
    private const val WIDTH = 320
    private const val INTERVAL_MS = 1000L

    private val state = MutableStateFlow<Bitmap?>(null)
    val frame: StateFlow<Bitmap?> = state
    @Volatile private var watchers = 0
    @Volatile private var last = 0L

    /** Önizleme ekranı açıldı ([on]) ya da kapandı. */
    @Synchronized
    fun watch(on: Boolean) {
        watchers = (watchers + if (on) 1 else -1).coerceAtLeast(0)
    }

    /** Çeviri hizmeti her karede çağırır; önizleme izlenmiyorsa hemen döner. */
    fun offer(image: Image, now: Long) {
        if (watchers == 0 || now - last < INTERVAL_MS) return
        last = now
        try {
            val crop = image.cropRect
            if (crop.width() <= 0 || crop.height() <= 0) return
            val height = (WIDTH.toLong() * crop.height() / crop.width()).toInt().coerceAtLeast(1)
            val plane = image.planes[0]
            val buffer = plane.buffer
            val pixels = IntArray(WIDTH * height)
            for (y in 0 until height) {
                val sy = crop.top + y * crop.height() / height
                for (x in 0 until WIDTH) {
                    val sx = crop.left + x * crop.width() / WIDTH
                    val v = buffer.get(sy * plane.rowStride + sx * plane.pixelStride).toInt() and 0xff
                    pixels[y * WIDTH + x] = (0xff shl 24) or (v shl 16) or (v shl 8) or v
                }
            }
            state.value = Bitmap.createBitmap(pixels, WIDTH, height, Bitmap.Config.ARGB_8888)
        } catch (error: RuntimeException) {
            // Kare bu arada bırakıldı; sonraki karede yeniden denenir.
        }
    }
}
