// SPDX-License-Identifier: AGPL-3.0-only

import AppKit
import CouchSubsCore
import SwiftUI

/// Ek alanın çevirisini bu Mac'te gösteren küçük kutu (Windows: PcResultWindow): ekranın altında ortada, her pencerenin
/// (tam ekran uygulamalar dahil) üstünde durur, odağı almaz. Süre dolunca ya da tıklanınca kapanır; yeni sonuç öncekinin
/// yerine geçer.
@MainActor
enum ResultPanel {
    private static var panel: NSPanel?
    private static var closing: DispatchWorkItem?

    static func show(_ text: String, milliseconds: Int) {
        close()
        let screen = NSScreen.main ?? NSScreen.screens.first
        let work = screen?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1280, height: 800)
        let host = NSHostingView(rootView: ResultBubble(text: text, maxWidth: work.width * 0.7) { ResultPanel.close() })
        let size = host.fittingSize
        let panel = NSPanel(contentRect: NSRect(x: work.midX - size.width / 2, y: work.minY + 40, width: size.width, height: size.height),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.hidesOnDeactivate = false
        panel.contentView = host
        panel.orderFrontRegardless()
        self.panel = panel
        let item = DispatchWorkItem { MainActor.assumeIsolated { ResultPanel.close() } }
        closing = item
        DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(max(1500, milliseconds)), execute: item)
    }

    static func close() {
        closing?.cancel()
        closing = nil
        panel?.orderOut(nil)
        panel = nil
    }
}

private struct ResultBubble: View {
    let text: String
    let maxWidth: CGFloat
    let dismiss: () -> Void

    var body: some View {
        Text(verbatim: text)
            .font(.system(size: 24))
            .foregroundStyle(.white)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: maxWidth - 40, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
            .background(Color.black.opacity(0.93), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .onTapGesture(perform: dismiss)
    }
}

/// Serbest alan çevirisi (Num 5; Windows: FreeAreaWindow): oyunun o anki görüntüsü bu Mac'in ekranında donar, kullanıcı
/// fareyle bir alan seçer, o alan bir kez okunup çevrilir. Sonuç seçilen alanın yanında görünür; ayara göre TV'ye de
/// gider. Esc ya da sağ tık pencereyi kapatır; kapatmadan başka alanlar da seçilebilir.
@MainActor
enum FreeAreaPanel {
    private static var panel: KeyPanel?

    /// Pencereyi açar; zaten açıksa öne getirir. Çeviri sürmüyorsa ya da kare yoksa bir şey yapmaz.
    static func open(_ model: AppModel) {
        if let panel {
            NSApp.activate(ignoringOtherApps: true)
            panel.makeKeyAndOrderFront(nil)
            return
        }
        guard model.isRunning, let frame = model.lastFrame, let screen = NSScreen.main ?? NSScreen.screens.first else { return }
        let panel = KeyPanel(contentRect: screen.frame, styleMask: [.borderless], backing: .buffered, defer: false)
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.backgroundColor = .black
        panel.isReleasedWhenClosed = false
        panel.onCancel = { FreeAreaPanel.close() }
        panel.contentView = NSHostingView(rootView: FreeAreaView(model: model, frame: frame) { FreeAreaPanel.close() })
        panel.setFrame(screen.frame, display: true)
        self.panel = panel
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
    }

    static func close() {
        panel?.orderOut(nil)
        panel = nil
    }

    /// Kenarsız da olsa tuş alan panel: Esc (cancelOperation) ve sağ tık kapatır.
    final class KeyPanel: NSPanel {
        var onCancel: (() -> Void)?
        override var canBecomeKey: Bool { true }
        override func cancelOperation(_ sender: Any?) { onCancel?() }
        override func rightMouseDown(with event: NSEvent) { onCancel?() }
    }
}

private struct FreeAreaView: View {
    @ObservedObject var model: AppModel
    let frame: CGImage
    let close: () -> Void
    @State private var start: CGPoint?
    @State private var selection: CGRect?
    @State private var result: String?
    /// Her seçim yeni numara alır; eski seçimin geç gelen sonucu yenisini ezmez.
    @State private var version = 0

    var body: some View {
        GeometryReader { geometry in
            let picture = fitted(in: geometry.size)
            ZStack(alignment: .topLeading) {
                Color.black
                Image(decorative: frame, scale: 1)
                    .resizable()
                    .frame(width: picture.width, height: picture.height)
                    .offset(x: picture.minX, y: picture.minY)
                if let selection {
                    Rectangle()
                        .fill(Color.csAccent.opacity(0.16))
                        .overlay(Rectangle().stroke(Color.csAccent, lineWidth: 2))
                        .frame(width: selection.width, height: selection.height)
                        .offset(x: selection.minX, y: selection.minY)
                    if let result {
                        bubble(result, below: selection, in: geometry.size)
                    }
                }
                Text("Drag over the text you want to translate. Esc or right-click closes.")
                    .font(.system(size: 15))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)
                    .background(Color.black.opacity(0.7))
                    .frame(maxWidth: .infinity)
                    .padding(.top, 12)
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0)
                .onChanged { value in
                    let origin = start ?? clamp(value.startLocation, to: picture)
                    start = origin
                    result = nil
                    selection = rect(origin, clamp(value.location, to: picture))
                }
                .onEnded { value in
                    let origin = start ?? clamp(value.startLocation, to: picture)
                    start = nil
                    translate(rect(origin, clamp(value.location, to: picture)), picture: picture)
                })
        }
        .onExitCommand(perform: close)
    }

    private func bubble(_ text: String, below area: CGRect, in size: CGSize) -> some View {
        let width = min(size.width * 0.5, max(area.width, 320))
        let x = min(max(0, area.minX), max(0, size.width - width))
        // Metin alanın altına konur; alan ekranın alt kısmındaysa üstüne.
        let below = area.maxY < size.height * 0.7
        return Text(verbatim: text)
            .font(.system(size: max(16, size.height * 0.026)))
            .foregroundStyle(.white)
            .fixedSize(horizontal: false, vertical: true)
            .frame(width: width - 32, alignment: .leading)
            .padding(16)
            .background(Color.black.opacity(0.9), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .padding(.leading, x)
            .padding(.top, below ? area.maxY + 12 : 0)
            .padding(.bottom, below ? 0 : size.height - area.minY + 12)
            .frame(width: size.width, height: size.height, alignment: below ? .topLeading : .bottomLeading)
            .allowsHitTesting(false)
    }

    /// Görüntünün oranı korunarak pencereye sığdırılmış yeri.
    private func fitted(in size: CGSize) -> CGRect {
        let scale = min(size.width / CGFloat(frame.width), size.height / CGFloat(frame.height))
        let width = CGFloat(frame.width) * scale, height = CGFloat(frame.height) * scale
        return CGRect(x: (size.width - width) / 2, y: (size.height - height) / 2, width: width, height: height)
    }

    private func clamp(_ point: CGPoint, to area: CGRect) -> CGPoint {
        CGPoint(x: min(max(point.x, area.minX), area.maxX), y: min(max(point.y, area.minY), area.maxY))
    }

    private func rect(_ a: CGPoint, _ b: CGPoint) -> CGRect {
        CGRect(x: min(a.x, b.x), y: min(a.y, b.y), width: abs(a.x - b.x), height: abs(a.y - b.y))
    }

    private func translate(_ area: CGRect, picture: CGRect) {
        // Tıklamak ya da çok küçük çizmek alan seçmez.
        guard area.width >= picture.width * 0.01, area.height >= picture.height * 0.01 else {
            selection = nil
            return
        }
        version += 1
        let token = version
        result = String(localized: "Translating…")
        let region = CropRegion(top: (area.minY - picture.minY) / picture.height, bottom: (area.maxY - picture.minY) / picture.height,
                                left: (area.minX - picture.minX) / picture.width, right: (area.maxX - picture.minX) / picture.width)
        Task {
            let (outcome, translated) = await model.translateFreeArea(frame, region)
            guard token == version else { return }
            switch outcome {
            case .shown: result = translated?.translation ?? ""
            case .noText: result = String(localized: "No text found in this area.")
            case .busy: result = String(localized: "Translating…")
            default: result = String(localized: "Could not translate this area.")
            }
            // Yalnız TV'de gösteriliyorsa bu Mac'in işi bitmiştir; pencere kendiliğinden kapanır.
            if outcome == .shown, model.settings.freeAreaTarget == .tv {
                try? await Task.sleep(for: .milliseconds(700))
                if token == version { close() }
            }
        }
    }
}
