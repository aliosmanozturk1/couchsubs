// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Mac/iPhone SubtitleBackgroundTests.swift ve Windows SubtitleBackgroundTests.cs ile aynı vektörler. */
class SubtitleBackgroundTest {
    private val width = 128
    private val height = 48

    private fun solid(red: Int, green: Int, blue: Int) = ByteArray(width * height * 4).also { fill(it, 0, 0, width, height, red, green, blue) }

    private fun fill(pixels: ByteArray, left: Int, top: Int, right: Int, bottom: Int, red: Int, green: Int, blue: Int) {
        for (y in top until bottom) for (x in left until right) {
            val i = (y * width + x) * 4
            pixels[i] = red.toByte()
            pixels[i + 1] = green.toByte()
            pixels[i + 2] = blue.toByte()
            pixels[i + 3] = 255.toByte()
        }
    }

    @Test
    fun keepsSubtitleOnBluePanelInDarkSceneAndDropsOtherText() {
        val pixels = solid(20, 20, 20)
        fill(pixels, 24, 16, 104, 32, 33, 33, 46)
        fill(pixels, 40, 21, 88, 27, 230, 230, 230)
        val reading = Reading(listOf(
            TextLine("Hey, you've reached Brian Heder.", TextBox(0.32, 20.0 / 48, 0.68, 27.0 / 48)),
            TextLine("PHOTO MODE", TextBox(0.80, 0.30, 0.95, 0.36)),
        ))
        assertEquals("Hey, you've reached Brian Heder.", SubtitleBackground.filter(reading, pixels, width, height).text)
    }

    @Test
    fun rejectsNeutralDarkPanel() {
        val pixels = solid(20, 20, 20)
        fill(pixels, 24, 16, 104, 32, 33, 33, 33)
        val reading = Reading(listOf(TextLine("Brian", TextBox(0.32, 20.0 / 48, 0.68, 27.0 / 48))))
        assertTrue(SubtitleBackground.filter(reading, pixels, width, height).lines.isEmpty())
    }

    @Test
    fun coordinatesMatchTopDownBoxes() {
        val pixels = solid(20, 20, 20)
        // Panel altta: görüntü ters okunsaydı üstteki menü yazısı kalırdı.
        fill(pixels, 24, 31, 104, 46, 33, 33, 46)
        val reading = Reading(listOf(
            TextLine("Menu text", TextBox(0.4, 5.0 / 48, 0.6, 12.0 / 48)),
            TextLine("Yes.", TextBox(0.4, 35.0 / 48, 0.6, 42.0 / 48)),
        ))
        assertEquals("Yes.", SubtitleBackground.filter(reading, pixels, width, height).text)
    }

    /** #534: Mac'te zemin #3D3D51'e kadar açık geliyor; Windows'taki #21212E ile ikisi de panel. Yazı ve sahne değil. */
    @Test
    fun panelColorFollowsChannelRelationNotFixedValue() {
        for ((red, green, blue) in listOf(Triple(33, 33, 46), Triple(61, 61, 81), Triple(22, 22, 34), Triple(36, 36, 52),
            Triple(48, 50, 66), Triple(80, 80, 100))) {
            assertTrue("$red,$green,$blue", SubtitleBackground.isPanelColor(red, green, blue))
        }
        val notPanel = listOf(Triple(33, 33, 33), Triple(61, 61, 61), Triple(230, 230, 230), Triple(255, 255, 255),
            Triple(235, 200, 40), Triple(250, 220, 90), Triple(20, 30, 70), Triple(40, 60, 140), Triple(70, 55, 40),
            Triple(40, 60, 35), Triple(90, 140, 200), Triple(120, 120, 130), Triple(5, 5, 12))
        for ((red, green, blue) in notPanel) assertFalse("$red,$green,$blue", SubtitleBackground.isPanelColor(red, green, blue))
    }

    @Test
    fun keepsSubtitleOnLighterPanel() {
        val pixels = solid(20, 20, 20)
        fill(pixels, 24, 16, 104, 32, 61, 61, 81)
        fill(pixels, 40, 21, 88, 27, 230, 230, 230)
        val reading = Reading(listOf(TextLine("Donnie dude.", TextBox(0.32, 20.0 / 48, 0.68, 27.0 / 48))))
        assertEquals("Donnie dude.", SubtitleBackground.filter(reading, pixels, width, height).text)
    }

    /** Android'e özgü: kare renk taşımıyorsa (çözücü biçimi bilinmiyor) zemin sınanamaz; altyazı kesilmez. */
    @Test
    fun readingIsKeptWhenFrameHasNoColor() {
        val reading = Reading(listOf(TextLine("Yes.", TextBox(0.4, 0.5, 0.6, 0.6))))
        assertEquals("Yes.", SubtitleBackground.filter(reading, width, height, null).text)
    }

    /**
     * Yeniden kullanılan okuma zemindeki yeni sözcükleri doğrular (kare yeniden okunur), zemin kalkınca yazı tanıma
     * çalışmaz (Mac/iPhone testReusedOcrConfirmsNewPanelWordsAndKeepsOcrIdleOnRemoval).
     */
    @Test
    fun reusedOcrConfirmsNewPanelWordsAndKeepsOcrIdleOnRemoval() {
        fun frame(top: Int?) = solid(33, 33, 33).also { if (top != null) fill(it, 10, top, 118, top + 18, 33, 33, 46) }
        val upper = frame(4)
        val lower = frame(26)
        val neutral = frame(null)
        var reads = 0
        fun ocr() = Reading(listOf(
            TextLine("Open the door.", TextBox(0.25, 0.22, 0.75, 0.32)),
            TextLine(if (reads++ == 0) "Open menu" else "Get back here!", TextBox(0.25, 0.64, 0.75, 0.74)),
        ))
        val watch = SubtitleBackground.Watch()
        var cached = Reading.Empty
        val seen = mutableListOf<String>()
        val left = mutableListOf<Boolean>()
        for ((index, image) in listOf(upper, upper, upper, lower, lower, lower, neutral, neutral, neutral).withIndex()) {
            val onPanel: (Reading) -> Reading = { SubtitleBackground.filter(it, image, width, height) }
            val step = if (index == 0) null else watch.reuse(cached, onPanel)
            if (step == null) {
                cached = ocr()
                seen.add(watch.read(cached, onPanel).text)
                left.add(false)
            } else {
                seen.add(step.visible.text)
                left.add(step.panelLeft)
            }
        }
        assertEquals(2, reads)
        assertEquals(listOf("Open the door.", "Open the door.", "Open the door.", "Get back here!", "Get back here!", "Get back here!", "", "", ""), seen)
        assertEquals(listOf(false, false, false, false, false, false, true, false, false), left)
        watch.reset()
        assertNull(watch.reuse(cached) { Reading(listOf(cached.lines.first())) })
    }

    /** Oyun telefonunun balonları TV'ye Mac/Windows ile aynı JSON'la gider: `surface` yalnız iki renk, büyük kutu korumasından geçer. */
    @Test
    fun gamePhoneBlocksCarryPlainSurfaceAndPassTheBigBoxGuard() {
        val style = TextSurface("#24272A", "#FFFFFF")
        val small = ScreenTranslation.Item("Hi", "Selam", TextBox(0.5, 0.5, 0.6, 0.55), 0.03, surface = style)
        val huge = ScreenTranslation.Item("Hey", "Hey", TextBox(0.0, 0.0, 1.0, 0.9), 0.03, surface = style)
        val frame = SubtitleServer.regionFrame(SubtitleServer.GAME_PHONE_ID, "Selam\nHey", TextBox(0.0, 0.0, 1.0, 0.9), 0.03, null, listOf(small, huge))
        assertTrue(frame, frame.contains("\"surface\":{\"background\":\"#24272A\",\"foreground\":\"#FFFFFF\"}"))
        assertFalse(frame.contains("flat"))
        assertFalse(frame.contains("\"text\":\"Hey\""))
        // Başka alanlarda `surface` eskisi gibi `flat` ile gider.
        assertTrue(SubtitleServer.regionFrame("auto-1", "Selam", small.box, 0.03, null, listOf(small)).contains("\"flat\":true"))

        // Telefon ekranı ("bu cihaz"): korumadan geçen balonlar ek alan kutusu gibi tek kutuda.
        val server = SubtitleServer(0)
        val events = mutableListOf<SubtitleEvent>()
        server.onEvent = { events.add(it) }
        server.sendRegion(SubtitleServer.GAME_PHONE_ID, "Selam\nHey", TextBox(0.0, 0.0, 1.0, 0.9), 0.03, null, listOf(small, huge))
        server.sendRegion(SubtitleServer.GAME_PHONE_ID, "", null, null, null, null)
        assertEquals(listOf<SubtitleEvent>(SubtitleEvent.Region(SubtitleServer.GAME_PHONE_ID, "Selam", small.box),
            SubtitleEvent.Region(SubtitleServer.GAME_PHONE_ID, "", null)), events)
    }
}
