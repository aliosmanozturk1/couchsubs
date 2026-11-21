// SPDX-License-Identifier: AGPL-3.0-only

import CouchSubsCore
import SwiftUI

/// Ayarlardaki Türkçe dublaj bölümü: açma, ses modelini indirme, çıkış, karakter sesleri.
struct DubbingCard: View {
    @EnvironmentObject private var model: AppModel

    var body: some View {
        Card(title: "Turkish dubbing") {
            SwitchRow(title: "Voice the translation in Turkish", isOn: $model.settings.dubbing.enabled)
            HintText(text: "In the game's audio settings, turn the dialogue (voice) volume down; keep music and effects. If the game can show speaker names in subtitles, turn them on: every character then speaks with its own voice.")

            if model.settings.dubbing.enabled {
                // "Ses: Doğal / Hızlı" (Windows ile aynı): Hızlı, Mac'in kendi Türkçe sesidir; indirme gerekmez.
                Picker("Voice", selection: $model.settings.dubbing.engine) {
                    Text("Natural").tag(DubbingEngine.natural)
                    Text("Fast").tag(DubbingEngine.fast)
                }
                .pickerStyle(.segmented)
                HintText(text: model.settings.dubbing.engine == .fast
                    ? "This Mac's own Turkish voice: speaks at once, nothing to download. Sounds more mechanical."
                    : "Natural voices, downloaded once. Each line takes a moment to prepare, so the voice can come a little after the subtitle.")
                if model.settings.dubbing.engine == .fast, !SystemSpeech.hasTurkishVoice {
                    ErrorText(error: String(localized: "No Turkish voice is installed on this Mac. Add one in System Settings › Accessibility › Spoken Content › System Voice › Manage Voices."))
                }
                if let progress = model.dubbingDownload, model.settings.dubbing.engine == .natural {
                    ProgressView(value: progress) {
                        Text("Downloading voices… \(Int(progress * 100))%")
                    }
                } else if !model.dubbingReady {
                    HStack {
                        Text("The voices are downloaded once (440 MB).").foregroundStyle(Color.csSecondary)
                        Spacer()
                        Button("Download voices") { Task { await model.downloadDubbingModel() } }.buttonStyle(.primary)
                    }
                } else {
                    Picker("Play the voice on", selection: $model.settings.dubbing.output) {
                        Text("TV").tag(DubbingOutput.tv)
                        Text("This Mac").tag(DubbingOutput.computer)
                    }
                    .pickerStyle(.segmented)
                    VoiceRow(title: Text("Narrator and unnamed lines"), voice: $model.settings.dubbing.cast.narrator)
                    VoiceRow(title: Text("Second speaker in dialogue"), voice: $model.settings.dubbing.cast.partner)
                    let names = model.settings.dubbing.cast.assignments.keys.sorted()
                    if !names.isEmpty {
                        Divider().overlay(Color.csBorder)
                        Text("Characters").font(.csHeadline)
                        ForEach(names, id: \.self) { name in
                            VoiceRow(title: Text(verbatim: Self.displayName(name)),
                                     voice: Binding(get: { model.settings.dubbing.cast.assignments[name] ?? .male1 },
                                                    set: { model.assignVoice($0, to: name) }))
                        }
                    }
                    if model.settings.dubbing.engine == .natural {
                        HintText(text: "Voices: Pocket TTS Turkish (wite-tech, CC BY 4.0) with Kyutai's pocket-tts. The voices are synthetic, not real people.")
                    }
                }
                if let error = model.dubbingError {
                    Text(error).font(.csCallout).foregroundStyle(Color.csDanger)
                }
            }
        }
    }

    /// "OLD MAN" → "Old Man"
    static func displayName(_ name: String) -> String {
        name.lowercased().split(separator: " ").map { $0.prefix(1).uppercased() + $0.dropFirst() }.joined(separator: " ")
    }
}

private struct VoiceRow: View {
    @EnvironmentObject private var model: AppModel
    let title: Text
    @Binding var voice: DubbingVoice

    var body: some View {
        HStack {
            Picker(selection: $voice) {
                ForEach(DubbingVoice.allCases, id: \.self) { voice in
                    Text(voice.label).tag(voice)
                }
            } label: {
                title
            }
            Button("Listen") { Task { await model.previewVoice(voice) } }.buttonStyle(.secondary)
        }
    }
}
