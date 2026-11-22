// SPDX-License-Identifier: AGPL-3.0-only

using System.Windows.Media;
using CouchSubs.App.Controls;
using CouchSubs.Core;

namespace CouchSubs.App.Services;

/// <summary>
/// Enmera'nın kendi uygulamalarının reklamları (Mac'teki AdCatalog ile aynı). Üçüncü taraf reklam ağı, izleme ve kişisel
/// veri yok: liste uygulamanın içinde (şimdilik tuvaldeki üç yerel örnek; uzaktan liste sonra), tıklanınca yalnız
/// bağlantı tarayıcıda açılır. Liste boşsa reklam bandı görünmez.
/// </summary>
public static class AdCatalog
{
    public const string Home = "https://enmera.com.tr";

    private static IReadOnlyList<BannerAd> banners = Samples();

    /// <summary>Bantta sırayla dönen reklamlar.</summary>
    public static IReadOnlyList<BannerAd> Banners
    {
        get => banners;
        set
        {
            banners = value;
            Changed?.Invoke();
        }
    }

    public static event Action? Changed;

    /// <summary>Tuvaldeki üç örnek reklam (içerikler belirlenince uzaktan listeyle değişecek).</summary>
    public static IReadOnlyList<BannerAd> Samples()
    {
        var text = Localizer.Current;
        return
        [
            new(text["App Name"], text["Sample ad: a short introduction goes here."], Home, Art(0x2B2D33, 0x5A5D66)),
            new(text["Second App"], text["Sample ad: ads rotate every 6 seconds."], Home, Art(0xF5B83D, 0xE0A22A)),
            new(text["Third App"], text["Sample ad: the contents will be decided later."], Home, Art(0x4FD1C5, 0x2B8A83)),
        ];
    }

    private static Brush Art(int from, int to)
    {
        static Color Rgb(int v) => Color.FromRgb((byte)(v >> 16), (byte)(v >> 8), (byte)v);
        var brush = new LinearGradientBrush(Rgb(from), Rgb(to), 45);
        brush.Freeze();
        return brush;
    }
}
