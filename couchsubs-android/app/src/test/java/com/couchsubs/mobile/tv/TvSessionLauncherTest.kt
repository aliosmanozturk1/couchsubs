// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.tv
import org.json.JSONObject
import org.junit.Test
import org.junit.Assert.*
class TvSessionLauncherTest {
    @Test fun bothBrandsReceiveServerAndKeyWithoutAdb() {
        val address = "http://192.168.1.4:8787"
        val key = "ABCDEFGHIJKLMNOPQRSTUV"
        val lg = JSONObject(TvSessionLauncher.launchMessage(TvBrand.LG, address, key)).getJSONObject("payload")
        assertEquals("com.couchsubs.tv", lg.getString("id"))
        val samsung = JSONObject(TvSessionLauncher.launchMessage(TvBrand.SAMSUNG, address, key)).getJSONObject("params").getJSONObject("data")
        assertEquals("CouchSubsT.CouchSubs", samsung.getString("appId"))
        for (params in listOf(lg.getJSONObject("params"), JSONObject(samsung.getString("metaTag")))) {
            assertEquals(address, params.getString("server")); assertEquals(key, params.getString("key"))
        }
    }
    /** #637, #511: kurulu olmayan uygulamaya DEEP_LINK gidince Smart Hub "Sunucu bakım altında (1544007)" diyor. */
    @Test fun samsungInstalledAppListDecidesLaunch() {
        assertEquals("ed.installedApp.get", JSONObject(TvSessionLauncher.SAMSUNG_INSTALLED_APPS_REQUEST).getJSONObject("params").getString("event"))
        val listed = """{"data":{"data":[{"appId":"111299001912","app_type":2,"name":"YouTube"},{"appId":"CouchSubsT.CouchSubs","app_type":2,"name":"CouchSubs"}]},"event":"ed.installedApp.get","from":"host"}"""
        assertEquals(TvSessionLauncher.SamsungAppPresence(true, 2), TvSessionLauncher.samsungInstalledApp(listed))
        assertEquals(TvSessionLauncher.SamsungAppPresence(false, null), TvSessionLauncher.samsungInstalledApp(listed.replace("CouchSubsT.CouchSubs", "Baska.App")))
        assertNull(TvSessionLauncher.samsungInstalledApp("""{"event":"ed.edenTV.update","data":{}}"""))
        assertNull(TvSessionLauncher.samsungInstalledApp("not json"))
        assertEquals("DEEP_LINK", TvSessionLauncher.samsungActionType(2))
        assertEquals("DEEP_LINK", TvSessionLauncher.samsungActionType(null))
        assertEquals("NATIVE_LAUNCH", TvSessionLauncher.samsungActionType(4))
        val native = JSONObject(TvSessionLauncher.launchMessage(TvBrand.SAMSUNG, "http://1.2.3.4:8787", "k", "NATIVE_LAUNCH"))
        assertEquals("NATIVE_LAUNCH", native.getJSONObject("params").getJSONObject("data").getString("action_type"))
    }
    /** beta.63: liste geliştirici moduyla kurulan uygulamayı içermiyorsa telefon uygulamayı hiç açmıyordu. */
    @Test fun samsungKnownInstalledAppLaunchesWithoutTheList() {
        val missing = TvSessionLauncher.SamsungAppPresence(false, null)
        // Uygulama bu TV'den daha önce bağlandı ya da bu telefon kurdu: liste "yok" dese de açılır.
        assertEquals("DEEP_LINK", TvSessionLauncher.samsungAction(true, missing))
        assertEquals("DEEP_LINK", TvSessionLauncher.samsungAction(true, null))
        // Hiç bağlanmamış ve kurulum kaydı yok: liste belirler; listede yoksa komut gönderilmez (#637).
        assertNull(TvSessionLauncher.samsungAction(false, missing))
        assertEquals("DEEP_LINK", TvSessionLauncher.samsungAction(false, TvSessionLauncher.SamsungAppPresence(true, 2)))
        assertEquals("NATIVE_LAUNCH", TvSessionLauncher.samsungAction(false, TvSessionLauncher.SamsungAppPresence(true, 4)))
        assertEquals("DEEP_LINK", TvSessionLauncher.samsungAction(false, null))

        val unknown = InstalledTv(TvBrand.SAMSUNG, "192.168.1.40")
        assertFalse(TvSessionLauncher.samsungKnownInstalled(unknown, null))
        assertFalse(TvSessionLauncher.samsungKnownInstalled(unknown, "192.168.1.41"))
        assertTrue(TvSessionLauncher.samsungKnownInstalled(unknown, "192.168.1.40"))
        assertTrue(TvSessionLauncher.samsungKnownInstalled(unknown.copy(version = "0.9.44"), null))
        assertFalse(TvSessionLauncher.samsungKnownInstalled(InstalledTv(TvBrand.LG, "192.168.1.40", version = "0.9.44"), "192.168.1.40"))
    }
    @Test fun registrationUsesPreviouslyApprovedTvCredential() {
        val payload = JSONObject(TvSessionLauncher.registerMessage("stored-tv-key")).getJSONObject("payload")
        assertEquals("stored-tv-key", payload.getString("client-key"))
        assertEquals("PROMPT", payload.getString("pairingType"))
        assertFalse(JSONObject(TvSessionLauncher.registerMessage(null)).getJSONObject("payload").has("client-key"))
    }

    /** Android TV: uygulama telefonun adresiyle açılır, bağlanana kadar arada bir yeniden; anahtar gitmez (iPhone'daki gibi). */
    @Test fun androidTvIsOpenedWithThePhoneAddressUntilItConnects() {
        val opened = mutableListOf<String>()
        val logged = mutableListOf<String>()
        var rounds = 0
        TvSessionLauncher.keepAndroidTvOpen(InstalledTv(TvBrand.ANDROID_TV, "192.168.1.120", 41235), "http://192.168.1.124:8787",
            active = { rounds < 4 }, connected = { rounds >= 2 },
            open = { host, port, params -> opened += "$host:$port $params"; "Starting" }, log = { logged += it }, sleep = { rounds++ })
        assertEquals(List(2) { """192.168.1.120:41235 {"server":"http://192.168.1.124:8787"}""" }, opened)
        assertEquals(1, logged.size)
    }

    @Test fun closedAdbOnAndroidTvIsSilentAndLoggedOnce() {
        val logged = mutableListOf<String>()
        var rounds = 0
        TvSessionLauncher.keepAndroidTvOpen(InstalledTv(TvBrand.ANDROID_TV, "192.168.1.120"), "http://192.168.1.124:8787",
            active = { rounds < 3 }, connected = { false },
            open = { _, port, _ -> assertEquals(5555, port); throw java.io.IOException("ADB kapalı") }, log = { logged += it }, sleep = { rounds++ })
        assertEquals(listOf("Android TV (192.168.1.120:5555) telefonun adresiyle açılamadı: ADB kapalı"), logged)
    }
}
