// SPDX-License-Identifier: AGPL-3.0-only

namespace CouchSubs.Core;

/// <summary>
/// "Ekranı çevir"de GTA 6 telefonu: eğik telefon ekranının üstüne yazmak okunmuyordu (yazı küçük, ekran yamuk). Telefon
/// karede bulunursa (<see cref="GamePhoneGeometry"/>) içindeki yazıların çevirisi telefonun hemen yanına, ekranda yer olan
/// tarafa, telefon boyunda açık renkli bir "mesaj kartı" olarak dizilir: en üstte kişi adı, altında her mesaj kendi
/// balonunda, okunan balonun yüksekliğinde. Telefonun sağ yarısına yaslı balon giden mesajdır (sağda, mavi), diğerleri
/// gelen (solda, beyaz). Telefon dışındaki yazılar kendi yerlerinde kalır. Kart TV'ye ve masaüstüne sıradan stilli öğeler
/// olarak gider (zemin, başlık, balonlar), ayrı bir çizim gerekmez (Mac: ScreenPhoneCard.swift, Android: ScreenPhoneCard.kt).
/// </summary>
public static class ScreenPhoneCard
{
    /// <summary>Kartın zemini: yazısı yalnız bölünmez boşluk olan öğe, kartın tamamını kaplar; balonlar üstüne çizilir.</summary>
    public const string BackdropText = " ";
    internal static readonly PhoneTextStyle CardColor = new("#F2F2F7", "#1C1C1E");
    internal static readonly PhoneTextStyle IncomingColor = new("#FFFFFF", "#1C1C1E");
    internal static readonly PhoneTextStyle OutgoingColor = new("#0A84FF", "#FFFFFF");
    /// <summary>Telefonla kart arasındaki boşluk ve kartın ekran kenarından payı (ekran genişliğine oranla).</summary>
    internal const double Gap = 0.008;
    /// <summary>Kart için yanda en az bu kadar yer olmalı; yoksa çeviriler telefonun üstünde kalır.</summary>
    internal const double MinWidth = 0.12;
    /// <summary>Balonun kart genişliğine oranı.</summary>
    internal const double BubbleShare = 0.8;

    /// <summary>Öğe kartın zemini mi (masaüstü listesi ve düz metin bunu atlar).</summary>
    public static bool IsBackdrop(ScreenTranslation.Item item) => string.IsNullOrWhiteSpace(item.Translation);

    /// <summary>Okunan karede telefon varsa yeri (kenarlara oranla); akla yatkın olmayan aday yok sayılır.</summary>
    public static TextBox? Phone(Frame frame)
    {
        if (GamePhoneGeometry.Locate(frame) is not { } bounds || !GamePhoneTracker.Plausible(bounds, frame)) return null;
        return new TextBox(bounds.Left, bounds.Top, bounds.Right, bounds.Bottom);
    }

    /// <summary>
    /// Telefondaki öğeleri kart olarak dizer. Telefonda çevrilmiş öğe yoksa ya da yanda yer yoksa liste olduğu gibi döner.
    /// Çevrilmemiş öğeler (<c>Unchanged</c>: kişi adı, "ok") kartta aslıyla görünür; kart dışındakiler sonra atılır.
    /// </summary>
    public static IReadOnlyList<ScreenTranslation.Item> Layout(IReadOnlyList<ScreenTranslation.Item> items, TextBox phone)
    {
        bool Inside(TextBox box)
        {
            double x = (box.Left + box.Right) / 2, y = (box.Top + box.Bottom) / 2;
            return x >= phone.Left && x <= phone.Right && y >= phone.Top && y <= phone.Bottom;
        }
        var onPhone = items.Where(item => Inside(item.Box)).OrderBy(item => item.Box.Top).ToList();
        if (!onPhone.Any(item => !item.Unchanged)) return items;
        var phoneWidth = phone.Right - phone.Left;
        double roomLeft = phone.Left - 2 * Gap, roomRight = 1 - phone.Right - 2 * Gap;
        var onLeft = roomLeft >= roomRight;
        var width = Math.Min(Math.Max(phoneWidth, MinWidth), Math.Max(roomLeft, roomRight));
        if (width < MinWidth) return items;
        var left = onLeft ? phone.Left - Gap - width : phone.Right + Gap;
        var card = new TextBox(left, phone.Top, left + width, phone.Bottom);
        var pad = width * 0.05;
        static TextLook Flat(string align, bool bold) => new(bold, false, align, false, true);

        var result = items.Where(item => !Inside(item.Box)).ToList();
        result.Add(new ScreenTranslation.Item("", BackdropText, card, onPhone.Min(item => item.LineHeight))
        {
            Style = CardColor, Look = Flat("left", false),
        });
        for (var i = 0; i < onPhone.Count; i++)
        {
            var item = onPhone[i];
            var top = Math.Max(card.Top, item.Box.Top);
            var bottom = Math.Min(card.Bottom, Math.Max(top + item.LineHeight, item.Box.Bottom));
            if (i == 0 && IsHeader(item, phone))
            {
                // Kişi adı: kartın başlığı, ortalı ve kalın; zemin kartın rengi.
                result.Add(item with
                {
                    Box = new TextBox(card.Left + pad, top, card.Right - pad, bottom), Style = CardColor, Look = Flat("center", true),
                    Unchanged = false,
                });
                continue;
            }
            // Telefonun sağ kenarına sol kenarından belirgin yakın balon giden mesajdır.
            var outgoing = phone.Right - item.Box.Right < (item.Box.Left - phone.Left) * 0.6;
            var bubble = width * BubbleShare;
            var x = outgoing ? card.Right - pad - bubble : card.Left + pad;
            result.Add(item with
            {
                Box = new TextBox(x, top, x + bubble, bottom), Style = outgoing ? OutgoingColor : IncomingColor,
                Look = Flat(outgoing ? "right" : "left", false), Unchanged = false,
            });
        }
        return result;
    }

    /// <summary>En üstteki kısa satır (en çok dört sözcük, tek parça) telefonun üst dörtte birindeyse kişi adıdır.</summary>
    internal static bool IsHeader(ScreenTranslation.Item item, TextBox phone) =>
        !item.Source.Contains('\n') && item.Source.Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Length <= 4
        && item.Box.Top < phone.Top + (phone.Bottom - phone.Top) * 0.25;
}
