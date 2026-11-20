// SPDX-License-Identifier: AGPL-3.0-only
// DeepL anahtarının bu ayki kullanımı ("Bu ay: … karakterin … kadarı kullanıldı."): Mac ve iPhone uygulamalarında ortak
// (Windows'ta SettingsWindow.ShowUsage, Android'de DeepLUsageNote aynı metni gösterir).

import CouchSubsCore
import Foundation

enum DeepLUsageText {
    /// `quotaUsedUp`: sınır dolunca gösterilen, cihaza göre değişen cümle (bilgisayarda yerel model, telefonda ücretsiz çeviri).
    static func describe(_ check: OnlineKeyCheck, quotaUsedUp: String) -> String {
        switch check.state {
        case .valid:
            String(format: String(localized: "This month: %1$@ of %2$@ characters used."),
                   check.used.formatted(), check.limit.formatted())
        case .quotaExceeded:
            quotaUsedUp
        case .invalid:
            String(localized: "DeepL did not accept this key. Copy it again from your DeepL account page.")
        case .keychainWriteFailed:
            String(localized: "The API key could not be saved to the Mac keychain.")
        case .unreachable, .modelRejected, .busy:
            String(localized: "DeepL could not be reached. Check your internet connection.")
        }
    }
}
