// SPDX-License-Identifier: AGPL-3.0-only

import CoreGraphics
import Foundation

/// "Ekranı çevir"de GTA 6 telefonu: eğik telefon ekranının üstüne yazmak okunmuyordu (yazı küçük, ekran yamuk). Telefon
/// karede bulunursa (`GamePhoneGeometry`) içindeki yazıların çevirisi telefonun hemen yanına, ekranda yer olan tarafa,
/// telefon boyunda açık renkli bir "mesaj kartı" olarak dizilir: en üstte kişi adı, altında her mesaj kendi balonunda,
/// okunan balonun yüksekliğinde. Telefonun sağ yarısına yaslı balon giden mesajdır (sağda, mavi), diğerleri gelen
/// (solda, beyaz). Telefon dışındaki yazılar kendi yerlerinde kalır. Kart, TV'ye ve masaüstüne sıradan stilli öğeler
/// olarak gider (zemin, başlık, balonlar), ayrı bir çizim gerekmez (Windows: ScreenPhoneCard.cs, Android: ScreenPhoneCard.kt).
public enum ScreenPhoneCard {
    /// Kartın zemini: yazısı yalnız bölünmez boşluk olan öğe, kartın tamamını kaplar; balonlar üstüne çizilir.
    public static let backdropText = "\u{00A0}"
    static let cardColor = PhoneTextStyle(background: "#F2F2F7", foreground: "#1C1C1E")
    static let incomingColor = PhoneTextStyle(background: "#FFFFFF", foreground: "#1C1C1E")
    static let outgoingColor = PhoneTextStyle(background: "#0A84FF", foreground: "#FFFFFF")
    /// Telefonla kart arasındaki boşluk ve kartın ekran kenarından payı (ekran genişliğine oranla).
    static let gap = 0.008
    /// Kart için yanda en az bu kadar yer olmalı; yoksa çeviriler telefonun üstünde kalır.
    static let minWidth = 0.12
    /// Balonun kart genişliğine oranı.
    static let bubbleShare = 0.8

    /// Öğe kartın zemini mi (masaüstü listesi ve düz metin bunu atlar).
    public static func isBackdrop(_ item: ScreenTranslation.Item) -> Bool {
        item.translation.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    /// Okunan karede telefon varsa yeri (kenarlara oranla); akla yatkın olmayan aday (bkz. `GamePhoneTracker.plausible`) yok sayılır.
    public static func phone(in frame: CGImage) -> TextBox? {
        guard let pose = GamePhoneGeometry.locate(frame) else { return nil }
        let bounds = pose.bounds
        guard GamePhoneTracker.plausible(bounds, width: frame.width, height: frame.height) else { return nil }
        return TextBox(left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom)
    }

    /// Telefondaki öğeleri kart olarak dizer. Telefonda çevrilmiş öğe yoksa ya da yanda yer yoksa liste olduğu gibi döner.
    /// Çevrilmemiş öğeler (`unchanged`: kişi adı, "ok") kartta aslıyla görünür; kart dışındakiler sonra atılır.
    public static func layout(_ items: [ScreenTranslation.Item], phone: TextBox) -> [ScreenTranslation.Item] {
        func inside(_ box: TextBox) -> Bool {
            let x = (box.left + box.right) / 2, y = (box.top + box.bottom) / 2
            return x >= phone.left && x <= phone.right && y >= phone.top && y <= phone.bottom
        }
        let onPhone = items.filter { inside($0.box) }.sorted { $0.box.top < $1.box.top }
        guard onPhone.contains(where: { !$0.unchanged }) else { return items }
        let phoneWidth = phone.right - phone.left
        let roomLeft = phone.left - 2 * gap, roomRight = 1 - phone.right - 2 * gap
        let onLeft = roomLeft >= roomRight
        let width = min(max(phoneWidth, minWidth), max(roomLeft, roomRight))
        guard width >= minWidth else { return items }
        let left = onLeft ? phone.left - gap - width : phone.right + gap
        let card = TextBox(left: left, top: phone.top, right: left + width, bottom: phone.bottom)
        let pad = width * 0.05
        let flat = { (align: TextLook.Align, bold: Bool) in TextLook(bold: bold, condensed: false, align: align, upper: false, flat: true) }

        var result = items.filter { !inside($0.box) }
        var backdrop = ScreenTranslation.Item(source: "", translation: backdropText, box: card,
                                              lineHeight: onPhone.map(\.lineHeight).min() ?? 0.02)
        backdrop.style = cardColor
        backdrop.look = flat(.left, false)
        result.append(backdrop)
        for (index, item) in onPhone.enumerated() {
            var placed = item
            placed.unchanged = false
            let top = max(card.top, item.box.top), bottom = min(card.bottom, max(top + item.lineHeight, item.box.bottom))
            if index == 0 && isHeader(item, phone: phone) {
                // Kişi adı: kartın başlığı, ortalı ve kalın; zemin kartın rengi.
                placed.box = TextBox(left: card.left + pad, top: top, right: card.right - pad, bottom: bottom)
                placed.style = cardColor
                placed.look = flat(.center, true)
            } else {
                // Telefonun sağ kenarına sol kenarından belirgin yakın balon giden mesajdır.
                let outgoing = phone.right - item.box.right < (item.box.left - phone.left) * 0.6
                let bubble = width * bubbleShare
                let x = outgoing ? card.right - pad - bubble : card.left + pad
                placed.box = TextBox(left: x, top: top, right: x + bubble, bottom: bottom)
                placed.style = outgoing ? outgoingColor : incomingColor
                placed.look = flat(outgoing ? .right : .left, false)
            }
            result.append(placed)
        }
        return result
    }

    /// En üstteki kısa satır (en çok dört sözcük, tek parça) telefonun üst dörtte birindeyse kişi adıdır.
    static func isHeader(_ item: ScreenTranslation.Item, phone: TextBox) -> Bool {
        !item.source.contains("\n") && item.source.split(whereSeparator: \.isWhitespace).count <= 4
            && item.box.top < phone.top + (phone.bottom - phone.top) * 0.25
    }
}
