// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.remoteplay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/** Bağlıyken görüntü kesilince oturum yeniden kurulur (Mac/Windows ile aynı kural). */
class PictureWatchdogTest {
    /**
     * Hata: istenen IDR karesi de bozuk gelince libchiaki yeniden istemiyor, bağlantı açık kalıp hiç kare gelmiyordu;
     * oturum hiç yeniden kurulmuyor, altyazı ancak uygulamayı kapatıp açınca dönüyordu.
     */
    @Test
    fun connectedWithoutPictureForEightSecondsIsStalled() {
        val watchdog = PictureWatchdog()
        watchdog.connected(0)
        for (second in 1..120) watchdog.picture(second * 1000L)
        // İki dakika görüntü geldi, sonra kesildi.
        assertNull(watchdog.stalledMs(127_000))
        assertEquals(PictureWatchdog.STALL_AFTER_MS, watchdog.stalledMs(128_000))
    }

    /** Olağan FEC duraklaması (IDR bir saniyeden kısa sürede gelir) oturumu yeniden kurdurmaz. */
    @Test
    fun shortGapIsNotAStall() {
        val watchdog = PictureWatchdog()
        watchdog.connected(0)
        watchdog.picture(1000)
        watchdog.picture(2500)
        assertNull(watchdog.stalledMs(9000))
    }

    /** Bağlandıktan sonra ilk kare hiç gelmezse de yakalanır. */
    @Test
    fun noFirstPictureIsStalled() {
        val watchdog = PictureWatchdog()
        watchdog.connected(0)
        assertNotNull(watchdog.stalledMs(PictureWatchdog.STALL_AFTER_MS))
    }

    /** Bağlı değilken görüntü beklenmez; geç gelen eski kare de bekçiyi kurmaz. */
    @Test
    fun notConnectedIsNeverStalled() {
        val watchdog = PictureWatchdog()
        watchdog.picture(0)
        assertNull(watchdog.stalledMs(600_000))
        watchdog.connected(0)
        watchdog.ended()
        assertNull(watchdog.stalledMs(600_000))
    }
}
