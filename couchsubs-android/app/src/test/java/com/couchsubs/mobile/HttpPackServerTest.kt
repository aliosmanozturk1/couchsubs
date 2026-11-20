// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile

import com.couchsubs.mobile.packs.HttpPackServer
import com.couchsubs.mobile.packs.PackDownloadException
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

/** Birincil adres (workers.dev) ulaşılamazsa yedek adres (#583). */
class HttpPackServerTest {
    private val primary = "https://packs.primary.test"
    private val fallback = "https://packs.fallback.test"
    private val listing = """{"packs":[{"id":"gta-6","title":"GTA 6","version":2,"sha256":"ab","size":3,"entries":1}]}"""

    /** [answers]: adres → sonuç (null: ağ hatası, Int: HTTP kodu, ByteArray: gövde). */
    private class Fake(val answers: Map<String, Any?>) {
        val calls = mutableListOf<String>()
        fun fetch(url: String): ByteArray {
            calls += url
            return when (val answer = answers[url]) {
                is ByteArray -> answer
                is Int -> throw PackDownloadException(answer, "HTTP $answer")
                else -> throw PackDownloadException(null, "unreachable")
            }
        }
    }

    @Test
    fun primaryWorksFallbackUntouched() {
        val fake = Fake(mapOf("$primary/v1/packs" to listing.toByteArray()))
        val server = HttpPackServer(listOf(primary, fallback), fake::fetch)
        assertEquals("gta-6", server.list().single().id)
        assertEquals(listOf("$primary/v1/packs"), fake.calls)
    }

    @Test
    fun networkErrorFallsBackAndRemembersWorkingAddress() {
        val fake = Fake(mapOf("$fallback/v1/packs" to listing.toByteArray(), "$fallback/v1/packs/gta-6" to byteArrayOf(1, 2, 3)))
        val server = HttpPackServer(listOf("$primary/", fallback), fake::fetch)
        assertEquals("gta-6", server.list().single().id)
        assertEquals(1, server.preferred)
        assertArrayEquals(byteArrayOf(1, 2, 3), server.download("gta-6"))
        // Paket doğrudan yedekten iner; birincil adres her istekte yeniden beklenmez.
        assertEquals(listOf("$primary/v1/packs", "$fallback/v1/packs", "$fallback/v1/packs/gta-6"), fake.calls)
    }

    @Test
    fun serverErrorFallsBack() {
        val fake = Fake(mapOf("$primary/v1/packs" to 503, "$fallback/v1/packs" to listing.toByteArray()))
        assertEquals(1, HttpPackServer(listOf(primary, fallback), fake::fetch).list().size)
    }

    @Test
    fun clientErrorIsFinal() {
        val fake = Fake(mapOf("$primary/v1/packs/x" to 429, "$fallback/v1/packs/x" to byteArrayOf(9)))
        val error = assertThrows(PackDownloadException::class.java) { HttpPackServer(listOf(primary, fallback), fake::fetch).download("x") }
        assertEquals(429, error.status)
        assertEquals(listOf("$primary/v1/packs/x"), fake.calls)
    }

    @Test
    fun bothDownIsNetworkErrorAndPrimaryTriedAgainLater() {
        val answers = mutableMapOf<String, Any?>()
        val fake = Fake(answers)
        val server = HttpPackServer(listOf(primary, fallback, primary, " "), fake::fetch)
        assertEquals(listOf(primary, fallback), server.baseUrls)
        val error = assertThrows(PackDownloadException::class.java) { server.list() }
        assertNull(error.status)
        assertEquals(listOf("$primary/v1/packs", "$fallback/v1/packs"), fake.calls)
    }

    @Test
    fun fallbackDownCyclesBackToPrimary() {
        val answers = mutableMapOf<String, Any?>("$fallback/v1/packs" to listing.toByteArray())
        val fake = Fake(answers)
        val server = HttpPackServer(listOf(primary, fallback), fake::fetch)
        server.list()
        assertEquals(1, server.preferred)
        answers.remove("$fallback/v1/packs")
        answers["$primary/v1/packs"] = listing.toByteArray()
        server.list()
        assertEquals(0, server.preferred)
    }
}
