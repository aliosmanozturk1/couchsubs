// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.settings

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Altyazı hedefi: TV, bu telefon ya da ikisi de (Mac/iPhone: SubtitleOutput.showsOnTV / showsOnComputer). */
class SubtitleTargetTest {
    @Test
    fun bothShowsOnTheTvAndOnThePhone() {
        assertTrue(SubtitleTarget.TV.showsOnTv)
        assertFalse(SubtitleTarget.TV.showsOnPhone)
        assertFalse(SubtitleTarget.PHONE.showsOnTv)
        assertTrue(SubtitleTarget.PHONE.showsOnPhone)
        assertTrue(SubtitleTarget.BOTH.showsOnTv)
        assertTrue(SubtitleTarget.BOTH.showsOnPhone)
    }

    /** Kayıtlı adlar değişmedi: eski kayıt (TV, PHONE) aynı okunur. */
    @Test
    fun storedNamesAreStable() {
        assertEquals(listOf("TV", "PHONE", "BOTH"), SubtitleTarget.entries.map { it.name })
    }
}
