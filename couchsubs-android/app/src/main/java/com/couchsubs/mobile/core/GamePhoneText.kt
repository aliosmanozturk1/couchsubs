// SPDX-License-Identifier: AGPL-3.0-only
package com.couchsubs.mobile.core

import kotlin.math.abs

/**
 * Oyun telefonundaki yazının kuralları: kullanıcı adları ve etiketler çevrilmez, mesaj listesindeki kişi adları oyunda
 * kalır, balonlar düz ekran koordinatlarıyla gruplanır (Mac/iPhone GamePhoneText.swift, Windows GamePhoneText.cs).
 */
object GamePhoneText {
    private val identifier = Regex("(?<![\\p{L}\\p{N}_])[@#][\\p{L}\\p{N}_]+(?:[.-][\\p{L}\\p{N}_]+)*")
    private val chatWord = Regex("(?<![\\p{L}\\p{N}_@#.-])(?:2gether|4u)(?![\\p{L}\\p{N}_])")
    private val misreadTen = Regex("(?<![\\p{L}\\p{N}_@#])(?:IO|I0|lO|l0)(?=\\s+min(?:s|utes?)?\\b)")
    private val sections = setOf("Messages", "Suggested", "Suggestions", "Öneriler", "Mesajlar")

    fun containsIdentifier(text: String): Boolean =
        (text.contains('@') || text.contains('#')) && identifier.containsMatchIn(text)

    fun isWrittenChatWord(token: String): Boolean =
        (token.contains('2') || token.contains('4')) && chatWord.containsMatchIn(token)

    /** İngilizce modele giden yazı: "IO min" → "10 min", "2gether" → "together", "4u" → "for you". */
    fun englishModelInput(text: String): String {
        val value = if (text.contains("min")) misreadTen.replace(text, "10") else text
        if (!isWrittenChatWord(value)) return value
        return chatWord.replace(value) { if (it.value == "2gether") "together" else "for you" }
    }

    /** Çevirideki kullanıcı adları ve etiketler özgün yazımına döner; biri kaybolmuş ya da değişmişse çeviri kullanılmaz (null). */
    fun keepIdentifiers(source: String, translation: String?): String? {
        if (translation.isNullOrEmpty() || !containsIdentifier(source)) return translation
        val names = identifier.findAll(source).map { it.value }.toMutableList()
        val result = StringBuilder(translation)
        for (match in identifier.findAll(translation).toList().reversed()) {
            val index = names.indexOfLast { it.equals(match.value, ignoreCase = true) }
            if (index < 0) return null
            result.replace(match.range.first, match.range.last + 1, names.removeAt(index))
        }
        return if (names.isEmpty()) result.toString() else null
    }

    private fun isTag(token: String): Boolean =
        (token.startsWith('@') || token.startsWith('#')) && identifier.matchEntire(token) != null

    private fun section(text: String): String? {
        val value = text.dropWhile { !it.isLetter() }.trim()
        return value.takeIf { it in sections }
    }

    private fun looksLikeName(text: String): Boolean {
        val label = text.takeWhile { it != '(' }.trim()
        val words = label.split(' ').filter { it.isNotEmpty() }
        if (section(label) != null || words.size !in 1..4 || !words[0][0].isUpperCase()) return false
        return words.all { word ->
            (word[0].isUpperCase() || word in setOf("de", "du", "of")) && word.all { it.isLetter() || it == '-' || it == '\'' }
        }
    }

    fun isMessagePreview(text: String): Boolean =
        text.any { it.isWhitespace() } && section(text) == null && !looksLikeName(text)

    private fun layout(line: TextLine): TextBox? = line.phoneBox ?: line.box

    private fun isContactPair(name: TextLine, preview: TextLine): Boolean {
        val label = name.text.trim()
        val lowerName = label.length in 2..18 && label.all { it.isLowerCase() }
        if (!(looksLikeName(label) || lowerName) || !preview.text.trim().contains(' ')) return false
        val a = layout(name) ?: return false
        val b = layout(preview) ?: return false
        val h = a.bottom - a.top
        return a.left > 0.1 && a.left < 0.48 && abs(a.left - b.left) <= 0.06 &&
            b.top > a.top && b.top - a.bottom < h * 0.7 && b.bottom - b.top < h * 1.8
    }

    /** Sağ kenara dayanan önizlemenin kesik sonu ("after .,") üç nokta olarak okunur. */
    private fun previewPunctuation(line: TextLine): TextLine {
        val box = layout(line) ?: return line
        if (box.right < 0.76) return line
        val tail = line.text.takeLastWhile { it in ".,„" }
        val stem = line.text.dropLast(tail.length)
        if (tail.length !in 2..3 || tail.first() != '.' || stem.lastOrNull()?.isLetter() != true || line.text.endsWith("...")) return line
        return line.copy(text = "$stem...")
    }

    /** Çevrilecek satırlar: yalnız etiketten oluşan satırlar ve tanınan mesaj listesindeki kişi adları çıkarılır. */
    fun forTranslation(reading: Reading): Reading {
        val lines = reading.lines.filter { line ->
            val words = line.text.split(Regex("\\s+")).filter { it.isNotEmpty() }
            !(words.any(::isTag) && words.all { word -> isTag(word) || word.none { it.isLetterOrDigit() } })
        }.toMutableList()
        val headings = lines.mapNotNull { section(it.text) }.toSet()
        if (headings.none { it in setOf("Suggested", "Suggestions", "Öneriler") } ||
            headings.none { it in setOf("Messages", "Mesajlar") }) return Reading(lines)
        for (i in lines.indices) section(lines[i].text)?.let { lines[i] = lines[i].copy(text = it) }
        val order = lines.indices.filter { layout(lines[it]) != null }.sortedBy { layout(lines[it])!!.top }
        val names = mutableListOf<Int>()
        val previews = mutableSetOf<Int>()
        var i = 0
        while (i + 1 < order.size) {
            val name = order[i]
            val preview = order[i + 1]
            if (isContactPair(lines[name], lines[preview])) {
                names.add(name)
                previews.add(preview)
                i += 2
            } else {
                i += 1
            }
        }
        if (names.size < 3) return Reading(lines)
        val first = layout(lines[names.first()]) ?: return Reading(lines)
        val last = layout(lines[names.last()]) ?: return Reading(lines)
        if (last.top <= first.top) return Reading(lines)
        val slope = (last.left - first.left) / (last.top - first.top)
        fun inColumn(line: TextLine): Boolean {
            val box = layout(line) ?: return false
            return abs(box.left - (first.left + slope * (box.top - first.top))) <= 0.06
        }
        if (!names.all { inColumn(lines[it]) }) return Reading(lines)
        return Reading(lines.indices.mapNotNull { index ->
            val line = lines[index]
            when {
                index in previews -> previewPunctuation(line)
                inColumn(line) && (index in names || looksLikeName(line.text)) -> null
                else -> line
            }
        })
    }

    /** Balonlar: düzleştirilmiş ekranda ([TextLine.phoneBox]) alt alta ve hizalı satırlar tek balondur. */
    fun groups(reading: Reading): List<ScreenTranslation.Group> {
        val flat = reading.lines.all { it.phoneBox != null }
        fun box(line: TextLine): TextBox = (if (flat) line.phoneBox else line.box)!!
        val groups = mutableListOf<ScreenTranslation.Group>()
        val run = mutableListOf<TextLine>()
        fun finish() {
            if (run.isEmpty()) return
            try {
                if (!flat) {
                    groups += ScreenTranslation.groups(Reading(run.toList()), keepIdentifiers = true)
                    return
                }
                val clean = Reading(run.toList()).withButtonIcons().withoutButtonPrompts().withoutOcrNoise(keepIdentifiers = true)
                    .lines.filter { it.box != null && ScreenText.isWords(it.text) }
                val first = clean.firstOrNull()?.box ?: return
                val place = clean.drop(1).fold(first) { total, line -> total.union(line.box!!) }
                val heights = run.map { box(it).bottom - box(it).top }.sorted()
                val icons = clean.flatMap { it.icons ?: emptyList() }
                groups += ScreenTranslation.Group(listOf(clean.joinToString(" ") { it.text }), place, heights[heights.size / 2],
                    if (icons.isEmpty()) null else listOf(icons))
            } finally {
                run.clear()
            }
        }
        for (line in reading.lines.filter { it.box != null }.sortedBy { box(it).top }) {
            run.lastOrNull()?.let { if (breaksBlock(box(it), box(line))) finish() }
            run.add(line)
        }
        finish()
        return groups.take(ScreenTranslation.MAX_GROUPS)
    }

    private fun breaksBlock(previous: TextBox, next: TextBox): Boolean {
        if (next.top - previous.bottom > maxOf(previous.bottom - previous.top, next.bottom - next.top)) return true
        val alignedLeft = abs(previous.left - next.left) <= 0.08
        val alignedRight = minOf(previous.left, next.left) > 0.25 && abs(previous.right - next.right) <= 0.045
        return !alignedLeft && !alignedRight
    }
}
