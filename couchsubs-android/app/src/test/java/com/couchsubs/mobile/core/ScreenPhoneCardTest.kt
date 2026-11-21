// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * "Ekranı çevir": stil eşleşmeli yerinde çizim, GTA 6 telefon kartı ve yeniden basınca ekranın değişip değişmediği
 * (Mac: ScreenPhoneCardTests.swift, Windows: ScreenPhoneCardTests.cs).
 */
class ScreenPhoneCardTest {
    private val phone = TextBox(0.72, 0.30, 0.96, 0.92)

    private fun item(source: String, translation: String, left: Double, top: Double, right: Double, unchanged: Boolean = false) =
        ScreenTranslation.Item(source, translation, TextBox(left, top, right, top + 0.03), 0.025, unchanged = unchanged)

    @Test
    fun phoneMessagesBecomeACardBesideThePhone() {
        val laid = ScreenTranslation.present(listOf(
            item("Donnie", "Donnie", 0.80, 0.33, 0.88, unchanged = true),
            item("Where are you man", "Neredesin adamım", 0.74, 0.45, 0.86),
            item("On my way", "Yoldayım", 0.85, 0.55, 0.95),
            item("Find the car", "Arabayı bul", 0.30, 0.10, 0.50),
        ), phone)
        // Telefon dışındaki yazı yerinde kalır.
        assertEquals("Arabayı bul", laid[0].translation)
        assertEquals(0.30, laid[0].box.left, 0.0)
        // Kart: zemin + başlık + iki balon, telefonun solunda (sağda yer yok), telefon boyunda.
        assertEquals(5, laid.size)
        val backdrop = laid[1]
        assertTrue(ScreenPhoneCard.isBackdrop(backdrop))
        assertEquals(phone.top, backdrop.box.top, 0.0)
        assertEquals(phone.bottom, backdrop.box.bottom, 0.0)
        assertTrue(backdrop.box.right < phone.left)
        val width = backdrop.box.right - backdrop.box.left
        assertEquals(phone.right - phone.left, width, 1e-9)
        // Kişi adı çevrilmese de kartın başlığıdır: ortalı, kalın.
        assertEquals("Donnie", laid[2].translation)
        assertEquals("center", laid[2].look?.align)
        assertEquals(true, laid[2].look?.bold)
        // Gelen mesaj solda beyaz, giden sağda mavi; yükseklikleri okunan balonunki.
        assertEquals(ScreenPhoneCard.INCOMING, laid[3].surface)
        assertEquals(backdrop.box.left + width * 0.05, laid[3].box.left, 1e-9)
        assertEquals(0.45, laid[3].box.top, 0.0)
        assertEquals(ScreenPhoneCard.OUTGOING, laid[4].surface)
        assertEquals("right", laid[4].look?.align)
        assertEquals(backdrop.box.right - width * 0.05, laid[4].box.right, 1e-9)
        assertTrue(laid.all { it.box.left >= 0 && it.box.right <= 1 })
    }

    @Test
    fun cardGoesRightWhenThePhoneIsOnTheLeft() {
        val left = TextBox(0.05, 0.30, 0.29, 0.92)
        val laid = ScreenPhoneCard.layout(listOf(item("Where are you man", "Neredesin adamım", 0.07, 0.45, 0.20)), left)
        assertTrue(laid[0].box.left > left.right)
    }

    @Test
    fun withoutATranslatedPhoneTextNothingMovesAndUnchangedItemsAreDropped() {
        val items = listOf(item("Donnie", "Donnie", 0.80, 0.33, 0.88, unchanged = true), item("Find the car", "Arabayı bul", 0.30, 0.10, 0.50))
        assertEquals(listOf("Arabayı bul"), ScreenTranslation.present(items, phone).map { it.translation })
        assertEquals(listOf("Arabayı bul"), ScreenTranslation.present(items, null).map { it.translation })
    }

    @Test
    fun noRoomBesideThePhoneKeepsTranslationsInPlace() {
        val items = listOf(item("Where are you man", "Neredesin adamım", 0.30, 0.45, 0.60))
        assertEquals(items, ScreenPhoneCard.layout(items, TextBox(0.10, 0.30, 0.90, 0.92)))
    }

    /** Çeviriler artık özgün yazının stilinde: koyu kutudaki açık yazı koyu zeminde açık, BÜYÜK HARF yazı büyük harf. */
    @Test
    fun translationsTakeTheLookOfTheOriginalText() {
        val width = 200
        val height = 40
        val luma = ByteArray(width * height) { index -> (if ((index / width) % 10 < 2 && (index % width) % 4 != 0) 230 else 30).toByte() }
        val items = ScreenTranslation.translate(Reading(listOf(TextLine("SCROLL THE LIST", TextBox(0.0, 0.0, 1.0, 1.0)))),
            { "listeyi kaydır" }, frame = GrayFrame(luma, width, height))
        assertEquals(1, items.size)
        assertEquals("#1E1E1E", items[0].surface?.background)
        assertEquals(true, items[0].look?.upper)
        assertEquals("LİSTEYİ KAYDIR", items[0].translation)
    }

    /** Başka bir sohbete geçince ekranın izi değişir: düğmeye yeniden basmak yeni sohbeti çevirir, sonuçları kaldırmaz. */
    @Test
    fun anotherChatIsADifferentScreen() {
        fun screen(vararg lines: String) = ScreenTranslation.fingerprint(Reading(lines.mapIndexed { i, text ->
            TextLine(text, TextBox(0.74, 0.35 + i * 0.08, 0.94, 0.38 + i * 0.08))
        }))
        val donnie = screen("Donnie", "Where are you man", "Meet me at the docks")
        assertTrue(ScreenTranslation.isSameScreen(donnie, screen("Donnie", "Where are you man", "Meet me at the docks")))
        assertTrue(ScreenTranslation.isSameScreen(donnie, screen("Donnie", "Where are you rnan", "Meet me at the docks")))
        assertFalse(ScreenTranslation.isSameScreen(donnie, screen("Lucia", "Did you get the money", "Call me back")))
        assertFalse(ScreenTranslation.isSameScreen(donnie, screen("Donnie", "Where are you man", "Meet me at the docks", "Hurry up")))
        assertTrue(ScreenTranslation.isSameScreen("", ""))
        assertFalse(ScreenTranslation.isSameScreen("", donnie))
    }
}
