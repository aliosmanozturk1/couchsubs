// SPDX-License-Identifier: AGPL-3.0-only

namespace CouchSubs.Core;

/// <summary>
/// Otomatik telefon okumasında çevirinin kararlılığı. Aynı mesajın OCR'la bir iki harfi farklı okunuşu yeni mesaj
/// sayılıyor, balon bir an özgün diline dönüp yeniden çevriliyor, çeviri her seferinde biraz değişiyordu; telefon tek
/// karede bulunamayınca da bütün çeviriler silinip geri geliyordu ("sürekli git gel yapıyor", X'teki bildirim). Mac/iPhone
/// (PhoneSteady.swift) ve Android (PhoneSteady.kt) aynı eşikleri kullanır.
/// </summary>
internal static class PhoneSteady
{
    /// <summary>Telefon art arda bu kadar turda bulunamazsa ya da okuma doğrulanamazsa çeviriler silinir.</summary>
    internal const int MissTurns = 3;
    /// <summary>Tek turluk OCR sapması (düşen balon, yan yana bozuk harfler) en çok bu kadar tur bekletilir.</summary>
    internal const int HoldTurns = 2;
    /// <summary>Aynı mesaj sayılmak için sadeleştirilmiş iki okumanın benzerliği (Levenshtein oranı) en az bu.</summary>
    internal const double SameMessage = 0.9;
    /// <summary>Kısa satırda bir harf anlamı değiştirir ("Ok" / "On"): benzer okuma yalnız bu kadar harften uzun mesajda kullanılır.</summary>
    internal const int MinimumLetters = 8;

    /// <summary>
    /// Mesajın bilinen çevirisi: birebir aynı okunuşunki, yoksa aynı mesajın OCR'la biraz farklı okunuşununki. Sayı ya da
    /// olumsuzluk ekleyen/düşüren okuma ("at 5" / "at 6", "can" / "can't") aynı mesaj sayılmaz. Birden çok aday varsa
    /// uzunluğu en yakın olan, eşitlikte sıralamada önce gelen (her platformda aynı sonuç).
    /// </summary>
    internal static string? Translation(string source, IReadOnlyDictionary<string, string> known)
    {
        if (known.TryGetValue(source, out var exact)) return exact;
        var text = TextMatch.Normalize(source);
        if (text.Count(char.IsLetter) < MinimumLetters) return null;
        (int Distance, string Source, string Translation)? best = null;
        foreach (var (old, translation) in known)
        {
            var other = TextMatch.Normalize(old);
            if (other.Count(char.IsLetter) < MinimumLetters || !TextMatch.IsSimilar(text, other, SameMessage)
                || TextMatch.AddsMeaning(source, old) || TextMatch.AddsMeaning(old, source)) continue;
            var distance = Math.Abs(text.Length - other.Length);
            if (best is not { } current || distance < current.Distance
                || (distance == current.Distance && string.CompareOrdinal(old, current.Source) < 0))
                best = (distance, old, translation);
        }
        return best?.Translation;
    }
}
