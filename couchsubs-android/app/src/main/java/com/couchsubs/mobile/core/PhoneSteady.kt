// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import kotlin.math.abs

/**
 * Otomatik telefon okumasında çevirinin kararlılığı. Aynı mesajın OCR'la bir iki harfi farklı okunuşu yeni mesaj
 * sayılıyor, balon bir an özgün diline dönüp yeniden çevriliyor, çeviri her seferinde biraz değişiyordu; telefon tek
 * karede bulunamayınca da bütün çeviriler silinip geri geliyordu ("sürekli git gel yapıyor", X'teki bildirim). Mac/iPhone
 * (PhoneSteady.swift) ve Windows (PhoneSteady.cs) aynı eşikleri kullanır.
 */
object PhoneSteady {
    /** Okuma art arda bu kadar turda doğrulanamazsa çeviriler silinir. */
    const val MISS_TURNS = 3
    /** Tek turluk OCR sapması (düşen balon, yan yana bozuk harfler) en çok bu kadar tur bekletilir. */
    const val HOLD_TURNS = 2
    /** Aynı mesaj sayılmak için sadeleştirilmiş iki okumanın benzerliği (Levenshtein oranı) en az bu. */
    const val SAME_MESSAGE = 0.9
    /** Kısa satırda bir harf anlamı değiştirir ("Ok" / "On"): benzer okuma yalnız bu kadar harften uzun mesajda kullanılır. */
    const val MINIMUM_LETTERS = 8

    /**
     * Mesajın bilinen çevirisi: birebir aynı okunuşunki, yoksa aynı mesajın OCR'la biraz farklı okunuşununki. Sayı ya da
     * olumsuzluk ekleyen/düşüren okuma ("at 5" / "at 6", "can" / "can't") aynı mesaj sayılmaz. Birden çok aday varsa
     * uzunluğu en yakın olan, eşitlikte sıralamada önce gelen (her platformda aynı sonuç).
     */
    fun translation(source: String, known: Map<String, String>): String? {
        known[source]?.let { return it }
        val text = TextMatch.normalize(source)
        if (text.count { it.isLetter() } < MINIMUM_LETTERS) return null
        var bestDistance = Int.MAX_VALUE
        var bestSource: String? = null
        var best: String? = null
        for ((old, translation) in known) {
            val other = TextMatch.normalize(old)
            if (other.count { it.isLetter() } < MINIMUM_LETTERS || !TextMatch.isSimilar(text, other, SAME_MESSAGE) ||
                TextMatch.addsMeaning(source, old) || TextMatch.addsMeaning(old, source)) continue
            val distance = abs(text.length - other.length)
            if (distance < bestDistance || (distance == bestDistance && old < bestSource!!)) {
                bestDistance = distance
                bestSource = old
                best = translation
            }
        }
        return best
    }
}
