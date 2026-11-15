// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.translation

import com.couchsubs.mobile.core.SubtitleSegmenter
import com.couchsubs.mobile.core.TextTranslator
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.TranslatorOptions
import java.io.IOException
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Ücretsiz, cihaz üstü çeviri: Google ML Kit EN→TR (model yaklaşık 30 MB, ilk kullanımda bir kez iner; sonra internetsiz
 * çalışır). Masaüstündeki yerel modeldeki gibi cümle cümle çevrilir, konuşmacı etiketi ve tireler olduğu gibi kalır.
 */
class MlKitTranslator : TextTranslator, AutoCloseable {
    private val translator = Translation.getClient(
        TranslatorOptions.Builder().setSourceLanguage(TranslateLanguage.ENGLISH).setTargetLanguage(TranslateLanguage.TURKISH).build()
    )
    private val cache = TranslationCache()

    /** Model yoksa indirir (bloklar). [wifiOnly]: hücresel veride indirme. */
    fun prepare(wifiOnly: Boolean = false, timeoutSeconds: Long = 300) {
        val conditions = DownloadConditions.Builder().apply { if (wifiOnly) requireWifi() }.build()
        await(translator.downloadModelIfNeeded(conditions), timeoutSeconds)
    }

    override fun translate(text: String): String {
        cache.get(text)?.let { return it }
        val pieces = SubtitleSegmenter.split(text)
        // iPhone ve Mac'teki ücretsiz metin hattıyla aynı: oyun deyimleri düz İngilizceye, çeviri Türkçe düzeltmelerden geçer;
        // hitap satırın bütününe bakar ("Sana söyledim. Bekleyin!" → "Bekle!").
        val sentences = pieces.map { piece ->
            if (!piece.translate) null
            else cache.get(piece.text) ?: translateSentence(piece.text).also { cache.store(piece.text, it) }
        }
        val final = TurkishPostEdit.register(sentences)
        val result = pieces.indices.joinToString("") { final[it] ?: pieces[it].text }
        cache.store(text, result)
        return result
    }

    private fun translateSentence(sentence: String): String {
        val input = GameEnglish.plain(SubtitleSegmenter.normalizeCase(sentence))
        return TurkishPostEdit.apply(sentence, await(translator.translate(input), 10))
    }

    override fun close() = translator.close()

    private fun <T> await(task: com.google.android.gms.tasks.Task<T>, seconds: Long): T = try {
        Tasks.await(task, seconds, TimeUnit.SECONDS)
    } catch (error: ExecutionException) {
        throw IOException("ML Kit: ${error.cause?.message}", error.cause)
    } catch (error: TimeoutException) {
        throw IOException("ML Kit timeout", error)
    }
}
