// SPDX-License-Identifier: AGPL-3.0-only

import Foundation

/// Otomatik telefon okumasında çevirinin kararlılığı. Aynı mesajın OCR'la bir iki harfi farklı okunuşu yeni mesaj
/// sayılıyor, balon bir an özgün diline dönüp yeniden çevriliyor, çeviri her seferinde biraz değişiyordu; telefon tek
/// karede bulunamayınca da bütün çeviriler silinip geri geliyordu ("sürekli git gel yapıyor", X'teki bildirim). Windows
/// (PhoneSteady.cs) ve Android (PhoneSteady.kt) aynı eşikleri kullanır.
enum PhoneSteady {
    /// Telefon art arda bu kadar turda bulunamazsa ya da okuma doğrulanamazsa çeviriler silinir.
    static let missTurns = 3
    /// Tek turluk OCR sapması (düşen balon, yan yana bozuk harfler) en çok bu kadar tur bekletilir.
    static let holdTurns = 2
    /// Aynı mesaj sayılmak için sadeleştirilmiş iki okumanın benzerliği (Levenshtein oranı) en az bu.
    static let sameMessage = 0.9
    /// Kısa satırda bir harf anlamı değiştirir ("Ok" / "On"): benzer okuma yalnız bu kadar harften uzun mesajda kullanılır.
    static let minimumLetters = 8

    /// Mesajın bilinen çevirisi: birebir aynı okunuşunki, yoksa aynı mesajın OCR'la biraz farklı okunuşununki. Sayı ya da
    /// olumsuzluk ekleyen/düşüren okuma ("at 5" / "at 6", "can" / "can't") aynı mesaj sayılmaz. Birden çok aday varsa
    /// uzunluğu en yakın olan, eşitlikte alfabede önce gelen (her platformda aynı sonuç).
    static func translation(of source: String, in known: [String: String]) -> String? {
        if let exact = known[source] { return exact }
        let text = TextMatch.normalize(source)
        guard text.filter(\.isLetter).count >= minimumLetters else { return nil }
        var best: (distance: Int, source: String, translation: String)?
        for (old, translation) in known {
            let other = TextMatch.normalize(old)
            guard other.filter(\.isLetter).count >= minimumLetters, TextMatch.isSimilar(text, other, threshold: sameMessage),
                  !TextMatch.addsMeaning(source, to: old), !TextMatch.addsMeaning(old, to: source) else { continue }
            let distance = abs(text.count - other.count)
            if best.map({ distance < $0.distance || (distance == $0.distance && old < $0.source) }) ?? true {
                best = (distance, old, translation)
            }
        }
        return best?.translation
    }
}
