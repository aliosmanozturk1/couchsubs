// SPDX-License-Identifier: AGPL-3.0-only

import SwiftUI

/// Kurulum sihirbazı: solda adım listesi, sağda adım (başlık zeminde, bloklar karoda; Ayarlar sayfası gibi), altında
/// Geri / Devam.
struct OnboardingView: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(alignment: .top, spacing: Theme.space("gap")) {
            StepSidebar()
            VStack(spacing: Theme.space("gap")) {
                ScrollViewReader { proxy in
                    ScrollView {
                        Group {
                            switch model.step {
                            case .welcome: WelcomeStep()
                            case .secondAccount: SecondAccountStep()
                            case .psnLogin: if model.isXbox { XboxLoginStep() } else { PSNLoginStep() }
                            case .console: if model.isXbox { XboxConsoleStep() } else { ConsoleStep() }
                            case .tv: TVStep()
                            case .test: TestStep()
                            case .betterTranslation, .done: BetterTranslationStep()
                            }
                        }
                        // Odak çerçeveleri kaydırma alanının kenarında kesilmesin diye içerik biraz içeride, alan aynı ölçüde
                        // dışarıda (Ayarlar sayfasıyla aynı yöntem).
                        .padding(Theme.space("m"))
                    }
                    // Adımlar kendi iletilerini görünür kılabilsin (ör. PS5 eşleşti iletisi kaydırılmış alanda kalmasın).
                    .environment(\.scrollOnboardingTo, { id in
                        withAnimation { proxy.scrollTo(id, anchor: .bottom) }
                    })
                }
                // Adımın kendi karoları var; dış karo yok (karo içinde karo olmasın).
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(-Theme.space("m"))
                StepButtons()
            }
        }
        .padding(Theme.space("screen"))
    }
}

extension EnvironmentValues {
    /// Sihirbazın kaydırma alanında verilen kimlikli görünüme kaydırır (adımın dışında hiçbir şey yapmaz).
    @Entry var scrollOnboardingTo: (String) -> Void = { _ in }
}

/// Geri ve Devam (ya da isteğe bağlı adımda "Şimdilik geç").
private struct StepButtons: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        HStack(spacing: Theme.space("m")) {
            if model.step != .welcome {
                Button("Back") { model.back() }.buttonStyle(CSButtonStyle(kind: .secondary, height: "buttonLarge"))
            }
            // Her adımda: konsolu olmayan (ve App Store incelemesi) uygulamayı örnek görüntülerle dener.
            DemoModeButton(kind: .ghost)
            Spacer()
            if model.step == .betterTranslation && !model.usesFreeGemini {
                // İsteğe bağlı adım: anahtar yoksa geçilir (birincil düğme adımdaki "Ücretsiz anahtar al").
                Button("Skip for now") { model.advance() }
                    .buttonStyle(CSButtonStyle(kind: .secondary, height: "buttonLarge"))
            } else if model.step != .test {
                Button("Continue") { model.advance() }
                    .buttonStyle(CSButtonStyle(kind: .primary, height: "buttonLarge"))
                    .keyboardShortcut(.defaultAction)
                    .disabled(!model.canAdvance)
            }
        }
    }
}

/// Adım listesi: biten adımlar onaylı, sıradaki adım vurgulu; altta "Adım n / toplam" ve ilerleme çubuğu.
private struct StepSidebar: View {
    @EnvironmentObject private var model: AppModel

    /// Xbox'ta "İkinci hesap" adımı yoktur; numaralar listedeki sıraya göredir.
    private var steps: [AppModel.Step] { model.wizardSteps }

    var body: some View {
        let total = steps.count
        let position = min((steps.firstIndex(of: model.step) ?? total - 1) + 1, total)
        VStack(alignment: .leading, spacing: Theme.space("xs")) {
            HStack(spacing: Theme.space("m")) {
                LogoView(size: 32)
                Text("Setup").font(.csTitle)
            }
            .padding(.horizontal, Theme.space("s"))
            .padding(.bottom, Theme.space("m"))
            ForEach(Array(steps.enumerated()), id: \.element) { index, step in
                StepRow(step: step, current: model.step, number: index + 1, xbox: model.isXbox)
            }
            Spacer(minLength: Theme.space("l"))
            Text(String(format: String(localized: "Step %lld of %lld"), position, total))
                .font(.csCaption.monospacedDigit())
                .foregroundStyle(Color.csSecondary)
                .padding(.horizontal, Theme.space("s"))
            ProgressBar(value: Double(position) / Double(total))
                .padding(.horizontal, Theme.space("s"))
                .padding(.top, Theme.space("xs"))
        }
        .frame(width: Theme.size("sidebarWidth"), alignment: .leading)
        .frame(maxHeight: .infinity, alignment: .top)
        .tile(padding: Theme.space("m"))
    }
}

private struct StepRow: View {
    let step: AppModel.Step
    let current: AppModel.Step
    /// Listedeki sıra (1'den).
    let number: Int
    var xbox = false

    private var isDone: Bool { step.rawValue < current.rawValue }
    private var isCurrent: Bool { step == current }

    var body: some View {
        HStack(spacing: Theme.space("m")) {
            marker
            Text(Self.title(step, xbox: xbox))
                .font(isCurrent ? .csBody.weight(.semibold) : .csBody)
                .foregroundStyle(isCurrent || isDone ? Color.csText : Color.csSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, Theme.space("s"))
        .padding(.vertical, Theme.space("s"))
        .background(isCurrent ? Color.csSurface2 : Color.clear, in: RoundedRectangle(cornerRadius: Theme.radius("control"), style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(isCurrent ? .isSelected : [])
    }

    /// Bitti: yeşil daire ve onay; şimdi: sarı daire; sonra: nötr daire. Parıltı yok.
    @ViewBuilder private var marker: some View {
        let size: CGFloat = 28
        if isDone {
            Image(systemName: "checkmark")
                .font(.csCaption.weight(.semibold))
                .foregroundStyle(Color.csSurface)
                .frame(width: size, height: size)
                .background(Circle().fill(Color.csSuccess))
        } else {
            Text("\(number)")
                .font(.csCaption.monospacedDigit().weight(.semibold))
                .foregroundStyle(isCurrent ? Color.csOnAccent : Color.csSecondary)
                .frame(width: size, height: size)
                .background(Circle().fill(isCurrent ? Color.csAccent : Color.csSurface2))
        }
    }

    /// Adımın kendi başlığı (adım ekranındaki StepLayout başlığıyla aynı).
    static func title(_ step: AppModel.Step, xbox: Bool = false) -> LocalizedStringKey {
        switch step {
        case .welcome: "Welcome to CouchSubs"
        case .secondAccount: "A second PSN account"
        case .psnLogin: xbox ? "Sign in to Xbox" : "Sign in with the second account"
        case .console: xbox ? "Choose your Xbox" : "Connect your PS5"
        case .tv: "Connect your TV"
        case .test: "Let's test it"
        case .betterTranslation, .done: "Better translation (free)"
        }
    }
}

/// İnce, yuvarlak uçlu ilerleme çubuğu.
struct ProgressBar: View {
    let value: Double

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.csBorder)
                Capsule().fill(Color.csAccent)
                    .frame(width: geometry.size.width * min(max(value, 0), 1))
                    .animation(.easeOut(duration: 0.25), value: value)
            }
        }
        .frame(height: 6)
        .accessibilityElement()
        .accessibilityValue(Text(verbatim: "\(Int(value * 100))%"))
    }
}
