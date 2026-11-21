// SPDX-License-Identifier: AGPL-3.0-only

import CoreGraphics
import XCTest
@testable import CouchSubsCore

/// "Ekranı çevir": stil eşleşmeli yerinde çizim, GTA 6 telefon kartı ve yeniden basınca ekranın değişip değişmediği
/// (Windows: ScreenPhoneCardTests.cs, Android: ScreenPhoneCardTest.kt).
final class ScreenPhoneCardTests: XCTestCase {
    private let phone = TextBox(left: 0.72, top: 0.30, right: 0.96, bottom: 0.92)

    private func item(_ source: String, _ translation: String, _ left: Double, _ top: Double, _ right: Double,
                      unchanged: Bool = false) -> ScreenTranslation.Item {
        var item = ScreenTranslation.Item(source: source, translation: translation,
                                          box: TextBox(left: left, top: top, right: right, bottom: top + 0.03), lineHeight: 0.025)
        item.unchanged = unchanged
        return item
    }

    func testPhoneMessagesBecomeACardBesideThePhone() {
        let items = [
            item("Donnie", "Donnie", 0.80, 0.33, 0.88, unchanged: true),
            item("Where are you man", "Neredesin adamım", 0.74, 0.45, 0.86),
            item("On my way", "Yoldayım", 0.85, 0.55, 0.95),
            item("Find the car", "Arabayı bul", 0.30, 0.10, 0.50),
        ]
        let laid = ScreenTranslation.present(items, phone: phone)
        // Telefon dışındaki yazı yerinde kalır.
        XCTAssertEqual(laid.first?.translation, "Arabayı bul")
        XCTAssertEqual(laid.first?.box.left, 0.30)
        // Kart: zemin + başlık + iki balon, telefonun solunda (sağda yer yok), telefon boyunda.
        XCTAssertEqual(laid.count, 5)
        let backdrop = laid[1]
        XCTAssertTrue(ScreenPhoneCard.isBackdrop(backdrop))
        XCTAssertEqual(backdrop.box.top, phone.top)
        XCTAssertEqual(backdrop.box.bottom, phone.bottom)
        XCTAssertLessThan(backdrop.box.right, phone.left)
        XCTAssertEqual(backdrop.box.right - backdrop.box.left, phone.right - phone.left, accuracy: 1e-9)
        // Kişi adı çevrilmese de kartın başlığıdır: ortalı, kalın.
        XCTAssertEqual(laid[2].translation, "Donnie")
        XCTAssertEqual(laid[2].look?.align, .center)
        XCTAssertEqual(laid[2].look?.bold, true)
        // Gelen mesaj solda beyaz, giden sağda mavi; yükseklikleri okunan balonunki.
        XCTAssertEqual(laid[3].style, ScreenPhoneCard.incomingColor)
        XCTAssertEqual(laid[3].box.left, backdrop.box.left + (backdrop.box.right - backdrop.box.left) * 0.05, accuracy: 1e-9)
        XCTAssertEqual(laid[3].box.top, 0.45)
        XCTAssertEqual(laid[4].style, ScreenPhoneCard.outgoingColor)
        XCTAssertEqual(laid[4].look?.align, .right)
        XCTAssertEqual(laid[4].box.right, backdrop.box.right - (backdrop.box.right - backdrop.box.left) * 0.05, accuracy: 1e-9)
        XCTAssertTrue(laid.allSatisfy { $0.box.left >= 0 && $0.box.right <= 1 })
    }

    func testCardGoesRightWhenThePhoneIsOnTheLeft() {
        let left = TextBox(left: 0.05, top: 0.30, right: 0.29, bottom: 0.92)
        let laid = ScreenPhoneCard.layout([item("Where are you man", "Neredesin adamım", 0.07, 0.45, 0.20)], phone: left)
        XCTAssertGreaterThan(laid[0].box.left, left.right)
    }

    func testWithoutATranslatedPhoneTextNothingMovesAndUnchangedItemsAreDropped() {
        let items = [item("Donnie", "Donnie", 0.80, 0.33, 0.88, unchanged: true), item("Find the car", "Arabayı bul", 0.30, 0.10, 0.50)]
        XCTAssertEqual(ScreenTranslation.present(items, phone: phone).map(\.translation), ["Arabayı bul"])
        XCTAssertEqual(ScreenTranslation.present(items, phone: nil).map(\.translation), ["Arabayı bul"])
    }

    func testNoRoomBesideThePhoneKeepsTranslationsInPlace() {
        let wide = TextBox(left: 0.10, top: 0.30, right: 0.90, bottom: 0.92)
        let items = [item("Where are you man", "Neredesin adamım", 0.30, 0.45, 0.60)]
        XCTAssertEqual(ScreenPhoneCard.layout(items, phone: wide), items)
    }

    /// Çeviriler artık özgün yazının stilinde: koyu kutudaki beyaz yazı koyu zeminde beyaz, BÜYÜK HARF yazı büyük harf.
    func testTranslationsTakeTheLookOfTheOriginalText() async throws {
        let frame = TextStyleSamplerTests.text((20, 22, 30), (240, 240, 240), stroke: 2)
        let box = TextBox(left: 0, top: 10.0 / 60, right: 1, bottom: 50.0 / 60)
        let items = try await ScreenTranslation.translate(Reading(lines: [TextLine("SCROLL THE LIST", box: box)]),
                                                          using: { _ in "listeyi kaydır" }, frame: frame)
        XCTAssertEqual(items.count, 1)
        XCTAssertEqual(items[0].style?.background, "#14161E")
        XCTAssertEqual(items[0].look?.upper, true)
        XCTAssertEqual(items[0].translation, "LİSTEYİ KAYDIR")
        // TV'ye stiliyle gider.
        let json = SubtitleServer.json(items[0])
        XCTAssertNotNil(json["surface"])
        XCTAssertNotNil(json["style"])
    }

    /// Başka bir sohbete geçince ekranın izi değişir: tuşa yeniden basmak yeni sohbeti çevirir, çevirileri kaldırmaz.
    func testAnotherChatIsADifferentScreen() {
        func screen(_ lines: [String]) -> String {
            ScreenTranslation.fingerprint(Reading(lines: lines.enumerated().map { index, text in
                TextLine(text, box: TextBox(left: 0.74, top: 0.35 + Double(index) * 0.08, right: 0.94, bottom: 0.38 + Double(index) * 0.08))
            }))
        }
        let donnie = screen(["Donnie", "Where are you man", "Meet me at the docks"])
        let again = screen(["Donnie", "Where are you man", "Meet me at the docks"])
        let misread = screen(["Donnie", "Where are you rnan", "Meet me at the docks"])
        let lucia = screen(["Lucia", "Did you get the money", "Call me back"])
        let newMessage = screen(["Donnie", "Where are you man", "Meet me at the docks", "Hurry up"])
        XCTAssertTrue(ScreenTranslation.isSameScreen(donnie, again))
        XCTAssertTrue(ScreenTranslation.isSameScreen(donnie, misread))
        XCTAssertFalse(ScreenTranslation.isSameScreen(donnie, lucia))
        XCTAssertFalse(ScreenTranslation.isSameScreen(donnie, newMessage))
        XCTAssertTrue(ScreenTranslation.isSameScreen("", ""))
        XCTAssertFalse(ScreenTranslation.isSameScreen("", donnie))
    }
}
