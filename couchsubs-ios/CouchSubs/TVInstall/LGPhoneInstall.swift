// SPDX-License-Identifier: AGPL-3.0-only
// LG (webOS) kurulumu: Key Server'dan anahtar ve 9922'de SSH ister; iPhone'a ayrı bir değişiklikle gelir. O zamana
// kadar LG'de sürüm okunmaz ve ilk kurulum bilgisayardaki CouchSubs ile yapılır.

import CouchSubsCore
import SwiftUI

enum LGPhoneInstall {
    static func installedVersion(host: String) -> String? { nil }
}

struct LGInstallSection: View {
    let update: TVAppUpdate?
    @Binding var working: Bool

    var body: some View {
        InstallIntro(body1: TVText.lgBody, note: TVText.lgNote)
        MobileNote(text: String(localized: "To install the TV app for the first time, use CouchSubs on a computer once. After that this phone is enough."),
                   tone: Mobile.Palette.secondary)
        Link(TVText.lgStepsTitle, destination: AppIdentity.tvGuideURL).font(Mobile.TypeScale.caption).tint(Mobile.Palette.accent)
    }
}
