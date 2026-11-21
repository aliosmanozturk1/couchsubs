// SPDX-License-Identifier: AGPL-3.0-only

using CouchSubs.Core;

namespace CouchSubs.Core.Tests;

/// <summary>
/// "Ekranı çevir": stil eşleşmeli yerinde çizim, GTA 6 telefon kartı ve yeniden basınca ekranın değişip değişmediği
/// (Mac: ScreenPhoneCardTests.swift, Android: ScreenPhoneCardTest.kt).
/// </summary>
public class ScreenPhoneCardTests
{
    private static readonly TextBox Phone = new(0.72, 0.30, 0.96, 0.92);

    private static ScreenTranslation.Item Item(string source, string translation, double left, double top, double right, bool unchanged = false) =>
        new(source, translation, new TextBox(left, top, right, top + 0.03), 0.025) { Unchanged = unchanged };

    [Fact]
    public void PhoneMessagesBecomeACardBesideThePhone()
    {
        var laid = ScreenTranslation.Present([
            Item("Donnie", "Donnie", 0.80, 0.33, 0.88, unchanged: true),
            Item("Where are you man", "Neredesin adamım", 0.74, 0.45, 0.86),
            Item("On my way", "Yoldayım", 0.85, 0.55, 0.95),
            Item("Find the car", "Arabayı bul", 0.30, 0.10, 0.50),
        ], Phone);
        // Telefon dışındaki yazı yerinde kalır.
        Assert.Equal("Arabayı bul", laid[0].Translation);
        Assert.Equal(0.30, laid[0].Box.Left);
        // Kart: zemin + başlık + iki balon, telefonun solunda (sağda yer yok), telefon boyunda.
        Assert.Equal(5, laid.Count);
        var backdrop = laid[1];
        Assert.True(ScreenPhoneCard.IsBackdrop(backdrop));
        Assert.Equal(Phone.Top, backdrop.Box.Top);
        Assert.Equal(Phone.Bottom, backdrop.Box.Bottom);
        Assert.True(backdrop.Box.Right < Phone.Left);
        Assert.Equal(Phone.Right - Phone.Left, backdrop.Box.Right - backdrop.Box.Left, 9);
        // Kişi adı çevrilmese de kartın başlığıdır: ortalı, kalın.
        Assert.Equal("Donnie", laid[2].Translation);
        Assert.Equal("center", laid[2].Look?.Align);
        Assert.True(laid[2].Look?.Bold);
        // Gelen mesaj solda beyaz, giden sağda mavi; yükseklikleri okunan balonunki.
        var width = backdrop.Box.Right - backdrop.Box.Left;
        Assert.Equal(ScreenPhoneCard.IncomingColor, laid[3].Style);
        Assert.Equal(backdrop.Box.Left + width * 0.05, laid[3].Box.Left, 9);
        Assert.Equal(0.45, laid[3].Box.Top);
        Assert.Equal(ScreenPhoneCard.OutgoingColor, laid[4].Style);
        Assert.Equal("right", laid[4].Look?.Align);
        Assert.Equal(backdrop.Box.Right - width * 0.05, laid[4].Box.Right, 9);
        Assert.All(laid, item => Assert.True(item.Box.Left >= 0 && item.Box.Right <= 1));
    }

    [Fact]
    public void CardGoesRightWhenThePhoneIsOnTheLeft()
    {
        var left = new TextBox(0.05, 0.30, 0.29, 0.92);
        var laid = ScreenPhoneCard.Layout([Item("Where are you man", "Neredesin adamım", 0.07, 0.45, 0.20)], left);
        Assert.True(laid[0].Box.Left > left.Right);
    }

    [Fact]
    public void WithoutATranslatedPhoneTextNothingMovesAndUnchangedItemsAreDropped()
    {
        ScreenTranslation.Item[] items = [Item("Donnie", "Donnie", 0.80, 0.33, 0.88, unchanged: true), Item("Find the car", "Arabayı bul", 0.30, 0.10, 0.50)];
        Assert.Equal(["Arabayı bul"], ScreenTranslation.Present(items, Phone).Select(item => item.Translation));
        Assert.Equal(["Arabayı bul"], ScreenTranslation.Present(items, null).Select(item => item.Translation));
    }

    [Fact]
    public void NoRoomBesideThePhoneKeepsTranslationsInPlace()
    {
        ScreenTranslation.Item[] items = [Item("Where are you man", "Neredesin adamım", 0.30, 0.45, 0.60)];
        Assert.Equal(items, ScreenPhoneCard.Layout(items, new TextBox(0.10, 0.30, 0.90, 0.92)));
    }

    /// <summary>Çeviriler artık özgün yazının stilinde: koyu kutudaki beyaz yazı koyu zeminde beyaz, BÜYÜK HARF yazı büyük harf.</summary>
    [Fact]
    public async Task TranslationsTakeTheLookOfTheOriginalText()
    {
        var frame = Frame.Blank(400, 60);
        for (var y = 0; y < 60; y++)
            for (var x = 0; x < 400; x++)
            {
                var ink = y is >= 15 and < 45 && x % 10 < 2;
                var p = y * frame.Stride + x * 4;
                (frame.Pixels[p], frame.Pixels[p + 1], frame.Pixels[p + 2], frame.Pixels[p + 3]) =
                    ink ? ((byte)240, (byte)240, (byte)240, (byte)255) : ((byte)30, (byte)22, (byte)20, (byte)255);
            }
        var box = new TextBox(0, 10.0 / 60, 1, 50.0 / 60);
        var items = await ScreenTranslation.TranslateAsync(new Reading([new TextLine("SCROLL THE LIST", box)]), new Fixed("listeyi kaydır"), frame: frame);
        var item = Assert.Single(items);
        Assert.Equal("#14161E", item.Style?.Background);
        Assert.True(item.Look?.Upper);
        Assert.Equal("LİSTEYİ KAYDIR", item.Translation);
    }

    /// <summary>Başka bir sohbete geçince ekranın izi değişir: tuşa yeniden basmak yeni sohbeti çevirir, çevirileri kaldırmaz.</summary>
    [Fact]
    public void AnotherChatIsADifferentScreen()
    {
        static string Screen(params string[] lines) => ScreenTranslation.Fingerprint(new Reading(
            lines.Select((text, i) => new TextLine(text, new TextBox(0.74, 0.35 + i * 0.08, 0.94, 0.38 + i * 0.08)))));
        var donnie = Screen("Donnie", "Where are you man", "Meet me at the docks");
        Assert.True(ScreenTranslation.IsSameScreen(donnie, Screen("Donnie", "Where are you man", "Meet me at the docks")));
        Assert.True(ScreenTranslation.IsSameScreen(donnie, Screen("Donnie", "Where are you rnan", "Meet me at the docks")));
        Assert.False(ScreenTranslation.IsSameScreen(donnie, Screen("Lucia", "Did you get the money", "Call me back")));
        Assert.False(ScreenTranslation.IsSameScreen(donnie, Screen("Donnie", "Where are you man", "Meet me at the docks", "Hurry up")));
        Assert.True(ScreenTranslation.IsSameScreen("", ""));
        Assert.False(ScreenTranslation.IsSameScreen("", donnie));
    }

    /// <summary>Masaüstü pencereleri stilli çevirileri ekran yazısı gibi gösterir; zemin ve stilsiz öğeler listede kalır.</summary>
    [Fact]
    public void DesktopWindowsShowStyledTranslationsAsARegion()
    {
        var look = new TextLook(false, false, "left", false, true);
        var styled = new SubtitleEvent(SubtitleEventKind.Screen, "Yoldayım", 12000, true, Blocks:
            [new ScreenTranslation.Item("", ScreenPhoneCard.BackdropText, Phone, 0.02) { Look = look }, Item("On my way", "Yoldayım", 0.5, 0.5, 0.7) with { Look = look }]);
        var region = ScreenRegions.Styled(styled, apart: true);
        Assert.NotNull(region);
        Assert.Equal(["Yoldayım"], region.Value.Blocks!.Select(item => item.Translation));
        Assert.Null(ScreenRegions.Styled(styled, apart: false));
        Assert.Null(ScreenRegions.Styled(styled with { Blocks = [Item("On my way", "Yoldayım", 0.5, 0.5, 0.7)] }, apart: true));
        Assert.Equal(3.0, ScreenRegions.NextChange(5.0, 3.0));
        Assert.Equal(5.0, ScreenRegions.NextChange(5.0, 0));
        Assert.Equal(3.0, ScreenRegions.NextChange(null, 3.0));
    }

    private sealed class Fixed(string text) : ITextTranslator
    {
        public Task<string> TranslateAsync(string source, CancellationToken cancellationToken = default) => Task.FromResult(text);
    }
}
