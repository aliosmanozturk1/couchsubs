// SPDX-License-Identifier: AGPL-3.0-only

using System.Windows;
using System.Windows.Media;
using CouchSubs.Core;
using CouchSubs.Shell;
using Microsoft.Win32;

namespace CouchSubs.App.Theme;

/// <summary>
/// design/tokens.json'daki değerleri uygulama kaynaklarına çevirir. Renkler ayarlardaki görünümle gelir (varsayılan
/// koyu; "Sistemle aynı" seçiliyse Windows'un uygulama temasını izler); XAML bunları DynamicResource ile kullanır,
/// görünüm değişince anında güncellenir.
/// </summary>
public static class ThemeManager
{
    private static readonly DesignTokens Tokens = DesignTokens.Shared;
    /// <summary>Uygulanan görünüm; null ise henüz uygulanmadı.</summary>
    private static AppAppearance? current;

    /// <summary>Koyu ve açık zorlanır; "Sistemle aynı" null döner (Windows'un teması izlenir).</summary>
    public static bool? ForceDark(AppAppearance appearance) => appearance switch
    {
        AppAppearance.Dark => true,
        AppAppearance.Light => false,
        _ => null,
    };

    /// <summary>Ayarlardaki görünümü uygular; aynı görünüm yeniden uygulanmaz.</summary>
    public static void Use(ResourceDictionary resources, AppAppearance appearance)
    {
        if (current == appearance) return;
        current = appearance;
        Apply(resources, ForceDark(appearance));
    }

    public static void Apply(ResourceDictionary resources, bool? forceDark = null)
    {
        var dark = forceDark ?? IsDarkTheme();
        IsDark = dark;
        foreach (var (name, pair) in Tokens.Color) SetColor(resources, name, pair.For(dark));
        foreach (var (name, font) in Tokens.Font) SetFont(resources, name, font.Size, font.Weight);
        foreach (var (name, value) in Tokens.Space) SetSpace(resources, name, value);
        foreach (var (name, value) in Tokens.Radius) resources[$"radius.{name}"] = new CornerRadius(value);
        foreach (var (name, value) in Tokens.Size) resources[$"size.{name}"] = value;
        // Yeni arayüzün değerleri (Palette) ortak değerlerin üstüne yazılır; eski adlar da yeni renkleri alır.
        foreach (var (name, pair) in Palette.Colors) SetColor(resources, name, dark ? pair.Dark : pair.Light);
        foreach (var (name, font) in Palette.Fonts) SetFont(resources, name, font.Size, font.Weight);
        foreach (var (name, value) in Palette.Space) SetSpace(resources, name, value);
        foreach (var (name, value) in Palette.Radius) resources[$"radius.{name}"] = new CornerRadius(value);
        foreach (var (name, value) in Palette.Size) resources[$"size.{name}"] = value;
        // Kart taban gölgesi yok; kartlar 1 px çerçeveyle ayrılır. Döşeme (tile) zemini hafif degradedir (tasarım: .tile).
        var tile = new LinearGradientBrush((Color)resources["tileTopColor"], (Color)resources["tileBottomColor"], 45);
        tile.Freeze();
        resources["tileBrush"] = tile;
        resources["windowBackgroundBrush"] = resources["backgroundBrush"];
        Changed?.Invoke();
    }

    /// <summary>Uygulanan tema koyu mu (kodda çizilen renkler için).</summary>
    public static bool IsDark { get; private set; }

    /// <summary>Tema her uygulandığında (kodda çizilen öğeler yenilensin diye).</summary>
    public static event Action? Changed;

    private static void SetColor(ResourceDictionary resources, string name, string hex) => SetColor(resources, name, ToColor(hex));

    private static void SetColor(ResourceDictionary resources, string name, Color color)
    {
        resources[$"{name}Color"] = color;
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        resources[$"{name}Brush"] = brush;
    }

    private static void SetFont(ResourceDictionary resources, string name, double size, string weight)
    {
        resources[$"{name}FontSize"] = size;
        resources[$"{name}FontWeight"] = weight switch
        {
            "bold" => FontWeights.Bold,
            "semibold" => FontWeights.SemiBold,
            "medium" => FontWeights.Medium,
            _ => FontWeights.Normal,
        };
    }

    private static void SetSpace(ResourceDictionary resources, string name, double value)
    {
        resources[$"space.{name}"] = value;
        resources[$"pad.{name}"] = new Thickness(value);
    }

    /// <summary>"Sistemle aynı" seçiliyken Windows'un teması değişince kaynakları yeniler.</summary>
    public static void Follow(ResourceDictionary resources)
    {
        SystemEvents.UserPreferenceChanged += (_, e) =>
        {
            if (e.Category == UserPreferenceCategory.General)
                Application.Current.Dispatcher.Invoke(() =>
                {
                    if (current is null or AppAppearance.System) Apply(resources);
                });
        };
    }

    public static bool IsDarkTheme()
    {
        using var key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
        return key?.GetValue("AppsUseLightTheme") is int light && light == 0;
    }

    private static Color ToColor(string hex)
    {
        var (r, g, b) = DesignTokens.Rgb(hex) ?? (0, 0, 0);
        return Color.FromRgb((byte)Math.Round(r * 255), (byte)Math.Round(g * 255), (byte)Math.Round(b * 255));
    }
}
