// SPDX-License-Identifier: AGPL-3.0-only

import Foundation

/// Çeviri başlayınca TV uygulamasını kendiliğinden açma neden olmadı (bekçinin son denemesi). Ana ekranda TV uygulaması
/// bağlı değilken tek satırla söylenir. Windows (TvOpenProblem) ve Android telefondaki (TvOpenProblem) ile aynı.
///
/// Eskiden açma sessizce başarısız oluyordu: kullanıcı TV'de CouchSubs'ı kendisinin açması gerektiğini bilmiyordu ("ilk
/// başta olmadı, sonra oldu; TV'den de uygulamayı açmak lazımmış", mobil sürüm, 21 Kas).
public enum TVOpenProblem: String, Sendable, Equatable {
    /// LG/Samsung: TV yanıt vermedi (kapalı, başka ağda ya da açmayı reddetti).
    case unreachable
    /// LG/Samsung: bu cihazın TV'den aldığı izin (anahtar) yok; TV'ye yeniden bağlanılmalı.
    case notPaired
    /// Android TV: ADB portuna ulaşılamadı (TV kapalı ya da ağ üzerinden hata ayıklama kapalı).
    case debugOff
    /// Android TV: TV bu cihazın hata ayıklama iznini onaylamamış (ADB eşleşmesi yok).
    case debugNotApproved

    /// Bekçinin bildirdiği sorun, ekranda gösterilecek olana çevrilir: LG/Samsung'da kayıtlı anahtar yokken yanıt vermeyen
    /// TV "izin yok" sayılır (TV'nin izin sorusu yanıtlanmamış).
    public static func shown(_ reported: TVOpenProblem?, brand: TVBrand, hasKey: Bool) -> TVOpenProblem? {
        guard let reported else { return nil }
        if reported == .unreachable, brand != .androidTV, !hasKey { return .notPaired }
        return reported
    }
}

/// TV uygulaması bağlı değilken ana ekranda görünen yönlendirme metinleri (İngilizce anahtar; Localizable.xcstrings TR/EN,
/// Windows da aynı anahtarları okur, Android strings.xml'de aynı metinler).
public enum TVOpenText {
    /// TV markasına göre tek cümle: CouchSubs TV'de nerede bulunur.
    public static func openOnTV(_ brand: TVBrand) -> String {
        brand == .androidTV
            ? "If CouchSubs didn't open on the TV by itself, open it on the TV: on Android TV it's under Apps."
            : "If CouchSubs didn't open on the TV by itself, open it on the TV: it's in the TV's app list."
    }

    /// Otomatik açmanın neden olmadığı (bilinmiyorsa nil).
    public static func reason(_ problem: TVOpenProblem?) -> String? {
        switch problem {
        case nil: nil
        case .unreachable: "Couldn't open it automatically: the TV didn't answer. Is the TV on and on the same Wi-Fi as this device?"
        case .notPaired: "Couldn't open it automatically: this device has no permission from the TV yet. Connect the TV again and allow it on the TV."
        case .debugOff: "Couldn't open it automatically: the TV can't be reached for debugging. Is the TV on, with network debugging on in Developer options?"
        case .debugNotApproved: "Couldn't open it automatically: the TV hasn't allowed debugging from this device. Reinstall the TV app and allow it on the TV."
        }
    }

    public static let tryButton = "Try opening automatically"

    /// Kurulum sihirbazının son adımı (TV seçildiyse).
    public static let wizardNote = "Every time you start translating, CouchSubs tries to open the TV app by itself. If it doesn't open, open CouchSubs on the TV."
}
