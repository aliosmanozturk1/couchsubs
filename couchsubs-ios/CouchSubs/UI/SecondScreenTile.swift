// SPDX-License-Identifier: AGPL-3.0-only

import CouchSubsCore
import SwiftUI
import UIKit

/// "Başka bir cihazda göster": QR kod, adres ve Kopyala (Mac, Windows ve Android'de aynı ad ve sıra). Ayarlar'da ve
/// altyazı hedefi seçiminde gösterilir; ikinci ekran her zaman ek bir alıcıdır, hedef seçimini değiştirmez.
struct SecondScreenTile: View {
    @EnvironmentObject private var model: PhoneModel
    @State private var copied = false

    var body: some View {
        Tile {
            Text("Show on another device").font(Mobile.TypeScale.headline)
            if let address = model.secondScreenAddress {
                if let code = SecondScreen.qrImage(for: address) {
                    // Koyu temada da okunsun diye kod beyaz zeminde; büyütülürken yumuşatılmaz.
                    Image(decorative: code, scale: 1)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 200, height: 200)
                        .padding(Mobile.Space.inline)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: Mobile.Radius.control))
                        .frame(maxWidth: .infinity)
                        .accessibilityLabel(Text("Show on another device"))
                }
                Text(verbatim: address)
                    .font(Mobile.TypeScale.caption.monospaced())
                    .textSelection(.enabled)
                    .padding(.horizontal, Mobile.Space.tile)
                    .frame(maxWidth: .infinity, minHeight: Mobile.Control.field, alignment: .leading)
                    .background(Mobile.Palette.surface2, in: RoundedRectangle(cornerRadius: Mobile.Radius.control))
                    .overlay(RoundedRectangle(cornerRadius: Mobile.Radius.control).strokeBorder(Mobile.Palette.border))
                Button {
                    UIPasteboard.general.string = address
                    copied = true
                } label: {
                    Label(copied ? "Copied" : "Copy", systemImage: copied ? "checkmark" : "doc.on.doc")
                }
                .buttonStyle(MobileButtonStyle(kind: .secondary, compact: true))
                .resetsAfterDelay($copied)
                Text("Scan the code with the camera of a phone or tablet on the same Wi-Fi. While translating, the subtitles appear large in its browser; no app or internet needed.")
                    .font(Mobile.TypeScale.caption).foregroundStyle(Mobile.Palette.secondary)
            } else {
                Text("Connect to Wi-Fi to show subtitles on another device.")
                    .font(Mobile.TypeScale.caption).foregroundStyle(Mobile.Palette.secondary)
            }
        }
    }
}
