// SPDX-License-Identifier: AGPL-3.0-only

namespace CouchSubs.Core;

/// <summary>
/// Oyun dünyasındaki yazı (tabela, tişört, plaka, afiş) altyazı alanına düşse de altyazı değildir. Alt bölge karenin
/// üçte birinden büyüktür (yükseklikte %35, genişlikte %72); GTA 6'da yürüyen karakterin tişörtü ya da sokaktaki tabela
/// o alana girince altyazı bloğu seçiliyor, ekranda altyazı yokken tek başına çevriliyordu (X bildirimleri, beta.73).
/// Altyazı bloğu seçilirken (<see cref="Reading.SubtitleBlock"/>) şu bloklar atılır; konuşan adı taşıyan blok hep
/// altyazıdır:
/// eğik satır (en az üç sözcük; perspektifli tabela: sözcüklerin dikey ortası satır boyunca tek yöne kayıyor ya da satır
/// kutusu sözcük boyunun <see cref="TiltedLineHeight"/> katından yüksek), düşük güvenli kısa blok (en çok
/// <see cref="LowConfidenceWords"/> sözcük, ortalama güven <see cref="LowConfidence"/>'tan az), karenin ortasındaki kısa,
/// noktalamasız tek satır (en çok üç sözcük; altyazı ve görev satırı karenin alt ya da üst kenarına yakındır,
/// <see cref="EdgeBand"/>). Mac/iPhone (SceneText.swift) ve Android (SceneText.kt) aynı kuralları ve eşikleri uygular;
/// ortak deneme dosyası core/Tests/CouchSubsCoreTests/Fixtures/scene-text.json.
/// </summary>
public static class SceneText
{
    /// <summary>Sözcüklerin dikey ortası ilk sözcükten sonuncuya bu kadar sözcük boyu kayarsa satır eğiktir.</summary>
    public const double TiltShift = 0.6;
    /// <summary>Satır kutusu sözcüklerin ortanca boyunun bu katından yüksekse satır eğiktir.</summary>
    public const double TiltedLineHeight = 1.8;
    public const double LowConfidence = 0.4;
    public const int LowConfidenceWords = 5;
    /// <summary>Kısa ve noktalamasız tek satır en çok bu kadar sözcüktür.</summary>
    public const int ShortWords = 3;
    /// <summary>Karenin alt ve üst kenarından bu kadarı (karenin yüksekliğine oranla) altyazı şerididir.</summary>
    public const double EdgeBand = 0.22;

    /// <summary>
    /// <paramref name="block"/> bir sahne yazısı mı. Satır kutuları <paramref name="area"/>'ya oranlıdır;
    /// <paramref name="area"/> okunan alanın karedeki yeridir.
    /// </summary>
    public static bool IsSceneText(Reading block, TextBox area)
    {
        if (block.Lines.Count == 0 || SpeakerPrefix.Parse(block.Lines[0].Text) is not null) return false;
        if (block.Lines.Any(line => line.Box is null)) return false;
        if (block.Lines.Any(IsTilted)) return true;
        var words = WordCount(block.Text);
        if (block.Confidence is { } confidence && confidence < LowConfidence && words <= LowConfidenceWords) return true;
        if (block.Lines.Count == 1 && words <= ShortWords && !LooksSpoken(block.Lines[0].Text))
        {
            var placed = block.Lines[0].Box!.Value.PlacedIn(area);
            var middle = (placed.Top + placed.Bottom) / 2;
            return middle > EdgeBand && middle < 1 - EdgeBand;
        }
        return false;
    }

    /// <summary>Sözcük yerleri biliniyorsa satır eğik mi (perspektifli tabela, yan duran tişört). Altyazı yatay yazılır.</summary>
    internal static bool IsTilted(TextLine line)
    {
        if (line.Words is not { Count: >= 3 } words || line.Box is not { } box) return false;
        var heights = words.Select(word => word.Box.Bottom - word.Box.Top).OrderBy(height => height).ToList();
        var median = heights[heights.Count / 2];
        if (median <= 0) return false;
        if (box.Bottom - box.Top > TiltedLineHeight * median) return true;
        var middles = words.OrderBy(word => word.Box.Left).Select(word => (word.Box.Top + word.Box.Bottom) / 2).ToList();
        var shift = middles[^1] - middles[0];
        if (Math.Abs(shift) <= TiltShift * median) return false;
        // Tek yöne kayma: aradaki sözcükler geri dönmez (yazı tanımanın kutu oynaması sözcük boyunun %15'i kadar).
        var direction = shift > 0 ? 1.0 : -1.0;
        return middles.Zip(middles.Skip(1)).All(pair => (pair.Second - pair.First) * direction >= -0.15 * median);
    }

    /// <summary>Konuşma izi: cümle sonu noktalaması, virgül, noktalı virgül ya da tırnak.</summary>
    private static bool LooksSpoken(string text) =>
        SubtitleStabilizer.EndsSentence(text) || text.Any(c => ",;\"“”".Contains(c));

    private static int WordCount(string text) =>
        text.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Count(word => word.Any(char.IsLetter));
}
