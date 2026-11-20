// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.translation

import org.junit.Assert.assertEquals
import org.junit.Test

/** Ayarlar'daki "Bu ay: … karakterin … kadarı kullanıldı." satırının kaynağı (Mac/iPhone: DeepLTranslator.check). */
class DeepLUsageTest {
    private class Scripted(private val status: Int, private val body: String) : Http {
        var url: String? = null
        var headers: Map<String, String> = emptyMap()
        override fun send(method: String, url: String, headers: Map<String, String>, body: String?, timeoutMs: Int): Pair<Int, String> {
            this.url = url
            this.headers = headers
            return status to this.body
        }
    }

    @Test
    fun usageIsReadFromTheUsageEndpoint() {
        val http = Scripted(200, """{"character_count":12345,"character_limit":500000}""")
        val usage = KeyCheck.deepLUsage(" abc:fx ", http)
        assertEquals(KeyCheck.DeepLUsage(OnlineKeyState.VALID, 12_345, 500_000), usage)
        assertEquals("https://api-free.deepl.com/v2/usage", http.url)
        assertEquals("DeepL-Auth-Key abc:fx", http.headers["Authorization"])
    }

    @Test
    fun usedUpLimitIsQuotaExceededWithTheNumbers() {
        val usage = KeyCheck.deepLUsage("abc", Scripted(200, """{"character_count":500000,"character_limit":500000}"""))
        assertEquals(KeyCheck.DeepLUsage(OnlineKeyState.QUOTA_EXCEEDED, 500_000, 500_000), usage)
        assertEquals(OnlineKeyState.QUOTA_EXCEEDED, KeyCheck.deepL("abc", Scripted(200, """{"character_count":500000,"character_limit":500000}""")))
    }

    @Test
    fun rejectedOrMissingKeyAndBrokenReply() {
        assertEquals(OnlineKeyState.INVALID, KeyCheck.deepLUsage("abc", Scripted(403, "")).state)
        assertEquals(OnlineKeyState.INVALID, KeyCheck.deepLUsage("  ", Scripted(200, "{}")).state)
        assertEquals(OnlineKeyState.UNREACHABLE, KeyCheck.deepLUsage("abc", Scripted(200, "not json")).state)
        val offline = Http { _, _, _, _, _ -> throw java.net.UnknownHostException("api.deepl.com") }
        assertEquals(OnlineKeyState.UNREACHABLE, KeyCheck.deepLUsage("abc", offline).state)
    }
}
