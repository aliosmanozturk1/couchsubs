// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Altyazı alanına düşen tabela ve tişört yazısı çevrilmez (X bildirimleri, beta.73, GTA 6). Örnekler ortak deneme
 * dosyasından (fixtures/scene-text.json, core/Tests/CouchSubsCoreTests/Fixtures kopyası; Mac SceneTextTests.swift ve
 * Windows SceneTextTests.cs aynı dosyayı okur).
 */
class SceneTextTest {
    private fun box(array: JSONArray) = TextBox(array.getDouble(0), array.getDouble(1), array.getDouble(2), array.getDouble(3))

    @Test
    fun sharedVectors() {
        val root = JSONObject(Fixtures.text("scene-text.json"))
        val area = box(root.getJSONArray("area"))
        val cases = root.getJSONArray("cases")
        for (i in 0 until cases.length()) {
            val case = cases.getJSONObject(i)
            val lines = case.getJSONArray("lines").let { array ->
                (0 until array.length()).map { j ->
                    val line = array.getJSONObject(j)
                    val words = line.optJSONArray("words")?.let { list ->
                        (0 until list.length()).map { k ->
                            val word = list.getJSONObject(k)
                            TextWord(word.getString("text"), box(word.getJSONArray("box")))
                        }
                    }
                    TextLine(line.getString("text"), box(line.getJSONArray("box")), words = words,
                        confidence = if (line.has("confidence")) line.getDouble("confidence").toFloat() else null)
                }
            }
            assertEquals(case.getString("name"), case.getString("subtitle"), Reading(lines).subtitleBlock(area).text)
        }
    }
}
