// SPDX-License-Identifier: AGPL-3.0-only

import Foundation

/// Oyun dünyasındaki yazı (tabela, tişört, plaka, afiş) altyazı alanına düşse de altyazı değildir. Alt bölge karenin
/// üçte birinden büyüktür (yükseklikte %35, genişlikte %72); GTA 6'da yürüyen karakterin tişörtü ya da sokaktaki tabela
/// o alana girince altyazı bloğu seçiliyor, ekranda altyazı yokken tek başına çevriliyordu (X bildirimleri, beta.73:
/// iPhone ve iPad). Altyazı bloğu seçilirken (`Reading.subtitleBlock`) şu bloklar atılır; konuşan adı taşıyan blok hep
/// altyazıdır:
/// - eğik satır (en az üç sözcük; perspektifli tabela: sözcüklerin dikey ortası satır boyunca tek yöne kayıyor ya da
///   satır kutusu sözcük boyunun `tiltedLineHeight` katından yüksek),
/// - düşük güvenli kısa blok (en çok `lowConfidenceWords` sözcük, ortalama güven `lowConfidence`'tan az),
/// - karenin ortasındaki kısa, noktalamasız tek satır (en çok üç sözcük; altyazı ve görev satırı karenin alt ya da üst
///   kenarına yakındır, `edgeBand`).
/// Windows (SceneText.cs) ve Android (SceneText.kt) aynı kuralları ve eşikleri uygular; ortak deneme dosyası
/// Tests/CouchSubsCoreTests/Fixtures/scene-text.json.
public enum SceneText {
    /// Sözcüklerin dikey ortası ilk sözcükten sonuncuya bu kadar sözcük boyu kayarsa satır eğiktir.
    public static let tiltShift = 0.6
    /// Satır kutusu sözcüklerin ortanca boyunun bu katından yüksekse satır eğiktir.
    public static let tiltedLineHeight = 1.8
    public static let lowConfidence = 0.4
    public static let lowConfidenceWords = 5
    /// Kısa ve noktalamasız tek satır en çok bu kadar sözcüktür.
    public static let shortWords = 3
    /// Karenin alt ve üst kenarından bu kadarı (karenin yüksekliğine oranla) altyazı şerididir.
    public static let edgeBand = 0.22

    /// `block` bir sahne yazısı mı. Satır kutuları `area`'ya oranlıdır; `area` okunan alanın karedeki yeridir.
    public static func isSceneText(_ block: Reading, in area: TextBox) -> Bool {
        guard let first = block.lines.first, SpeakerPrefix.split(first.text) == nil else { return false }
        let placed = block.lines.compactMap { $0.box?.placed(in: area) }
        guard placed.count == block.lines.count else { return false }
        if block.lines.contains(where: isTilted) { return true }
        let words = wordCount(block.text)
        if let confidence = block.confidence, confidence < lowConfidence, words <= lowConfidenceWords { return true }
        if block.lines.count == 1, words <= shortWords, !looksSpoken(first.text) {
            let middle = (placed[0].top + placed[0].bottom) / 2
            return middle > edgeBand && middle < 1 - edgeBand
        }
        return false
    }

    /// Sözcük yerleri biliniyorsa satır eğik mi (perspektifli tabela, yan duran tişört). Altyazı yatay yazılır.
    static func isTilted(_ line: TextLine) -> Bool {
        guard let words = line.words, words.count >= 3, let box = line.box else { return false }
        let heights = words.map { $0.box.bottom - $0.box.top }.sorted()
        let median = heights[heights.count / 2]
        guard median > 0 else { return false }
        if box.bottom - box.top > tiltedLineHeight * median { return true }
        let middles = words.sorted { $0.box.left < $1.box.left }.map { ($0.box.top + $0.box.bottom) / 2 }
        let shift = middles.last! - middles.first!
        guard abs(shift) > tiltShift * median else { return false }
        // Tek yöne kayma: aradaki sözcükler geri dönmez (yazı tanımanın kutu oynaması sözcük boyunun %15'i kadar).
        let direction: Double = shift > 0 ? 1 : -1
        return zip(middles, middles.dropFirst()).allSatisfy { ($1 - $0) * direction >= -0.15 * median }
    }

    /// Konuşma izi: cümle sonu noktalaması, virgül, noktalı virgül ya da tırnak.
    private static func looksSpoken(_ text: String) -> Bool {
        SubtitleStabilizer.endsSentence(text) || text.contains(where: { ",;\"“”".contains($0) })
    }

    private static func wordCount(_ text: String) -> Int {
        text.split(whereSeparator: \.isWhitespace).filter { $0.contains(where: \.isLetter) }.count
    }
}
