// SPDX-License-Identifier: AGPL-3.0-only

import CouchSubsCore
import SwiftUI

// Dublaj seslerinin adları; Mac ve iPhone ayarları ortak kullanır (couchsubs-ios/project.yml).
extension DubbingVoice {
    var label: LocalizedStringKey {
        switch self {
        case .female1: "Woman 1 (bright)"
        case .female2: "Woman 2 (warm)"
        case .female3: "Woman 3 (confident)"
        case .male1: "Man 1 (calm, deep)"
        case .male2: "Man 2 (energetic)"
        case .male3: "Man 3 (crisp)"
        }
    }
}
