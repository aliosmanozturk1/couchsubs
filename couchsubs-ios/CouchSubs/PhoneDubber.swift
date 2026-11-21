// SPDX-License-Identifier: AGPL-3.0-only

import AVFoundation
import CouchSubsCore
import Foundation

/// Telefonda Türkçe dublaj: çeviri iPhone'un kendi Türkçe sesiyle (AVSpeechSynthesizer) okunur. Windows'taki "Hızlı"
/// dublajla aynı: indirme yok, karakterler ton ve hızla ayrılır (`DubbingVoice.systemTone`), ses atamaları (`VoiceCast`)
/// masaüstüyle aynı. Ses ya bu telefondan çalar ya da WAV olarak TV uygulamasına gider (`SubtitleServer.sendSpeech`).
/// Yeni altyazı gelince eski cümleler kesilir: dublaj hep ekrandaki altyazıyı söyler.
@MainActor
final class PhoneDubber {
    private let synthesizer = AVSpeechSynthesizer()
    private let server: () -> SubtitleServer
    private var queue: [SpokenLine] = []
    private var worker: Task<Void, Never>?
    private var generation = 0

    var cast: VoiceCast
    var output: DubbingOutput
    /// Yeni bir karaktere ses verildi; ayarlara kaydedilir.
    var onCastChanged: ((VoiceCast) -> Void)?

    /// Bekleyen en çok cümle (masaüstüyle aynı): fazlası eskiden başlayarak atlanır.
    static let backlog = 3

    init(server: @escaping () -> SubtitleServer, settings: DubbingSettings) {
        self.server = server
        cast = settings.cast
        output = settings.output
    }

    /// Cihazda Türkçe ses var mı (yoksa sistemin varsayılan sesi Türkçeyi yabancı aksanla okur).
    static var hasTurkishVoice: Bool { turkishVoice != nil }

    private static var turkishVoice: AVSpeechSynthesisVoice? {
        AVSpeechSynthesisVoice(language: "tr-TR")
            ?? AVSpeechSynthesisVoice.speechVoices().first { $0.language.hasPrefix("tr") }
    }

    func speak(_ lines: [SpokenLine]) {
        guard !lines.isEmpty else { return }
        stop()
        queue = Array(lines.suffix(Self.backlog))
        generation += 1
        let current = generation
        worker = Task { await run(current) }
    }

    /// Ayarlardaki "Dinle": deneme cümlesi her zaman bu telefondan çalar (kullanıcı o an telefonun başında).
    func preview(_ voice: DubbingVoice) {
        stop()
        synthesizer.speak(Self.utterance("Merhaba, oyundaki karakterleri Türkçe seslendireceğim.", voice: voice))
    }

    func stop() {
        queue.removeAll()
        worker?.cancel()
        worker = nil
        generation += 1
        synthesizer.stopSpeaking(at: .immediate)
        server().stopSpeech()
    }

    private func run(_ number: Int) async {
        while !queue.isEmpty, number == generation, !Task.isCancelled {
            let line = queue.removeFirst()
            let before = cast
            let voice = cast.voice(for: line)
            if cast.assignments != before.assignments { onCastChanged?(cast) }
            // Duygu etiketi ("[kızgın]") yalnız Pocket TTS içindir; sistem sesi onu yüksek sesle okurdu.
            let text = SpeechText.prepare(line.turkish)
            let utterance = Self.utterance(text, voice: voice)
            switch output {
            case .computer:
                synthesizer.speak(utterance)
                // Sıradaki cümle bu bitince başlar (konuşma başlayana kadar kısa bekleme).
                try? await Task.sleep(nanoseconds: 150_000_000)
                while synthesizer.isSpeaking, number == generation, !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 50_000_000)
                }
            case .tv:
                guard let audio = await Self.render(utterance, with: synthesizer), number == generation, !Task.isCancelled else { return }
                let milliseconds = Int(audio.duration * 1000)
                server().sendSpeech(audio.wav, durationMs: milliseconds)
                // TV sesi ağdan alıp çalmaya biraz geç başlar; sıradaki cümle bunu kesmesin.
                try? await Task.sleep(nanoseconds: UInt64(milliseconds + 250) * 1_000_000)
            }
        }
    }

    static func utterance(_ text: String, voice: DubbingVoice) -> AVSpeechUtterance {
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = turkishVoice
        let tone = voice.systemTone
        utterance.pitchMultiplier = Float(min(max(tone.pitch, 0.5), 2.0))
        utterance.rate = min(max(AVSpeechUtteranceDefaultSpeechRate * Float(tone.rate), AVSpeechUtteranceMinimumSpeechRate),
                             AVSpeechUtteranceMaximumSpeechRate)
        return utterance
    }

    /// Cümleyi sese çevirir (çalmadan): TV'ye gidecek WAV için örnekler toplanır.
    private static func render(_ utterance: AVSpeechUtterance, with synthesizer: AVSpeechSynthesizer) async -> SpeechAudio? {
        await withCheckedContinuation { (continuation: CheckedContinuation<SpeechAudio?, Never>) in
            let collector = SampleCollector(continuation)
            synthesizer.write(utterance) { buffer in collector.add(buffer) }
        }
    }
}

/// AVSpeechSynthesizer.write'ın parçalarını toplar; boş parça sesin bittiğini bildirir.
private final class SampleCollector: @unchecked Sendable {
    private var continuation: CheckedContinuation<SpeechAudio?, Never>?
    private var samples: [Float] = []
    private var sampleRate = 22050
    private let lock = NSLock()

    init(_ continuation: CheckedContinuation<SpeechAudio?, Never>) { self.continuation = continuation }

    func add(_ buffer: AVAudioBuffer) {
        lock.lock()
        defer { lock.unlock() }
        guard let pcm = buffer as? AVAudioPCMBuffer else { return finish() }
        if pcm.frameLength == 0 { return finish() }
        sampleRate = Int(pcm.format.sampleRate)
        let count = Int(pcm.frameLength)
        if let data = pcm.floatChannelData {
            samples.append(contentsOf: UnsafeBufferPointer(start: data[0], count: count))
        } else if let data = pcm.int16ChannelData {
            samples.append(contentsOf: UnsafeBufferPointer(start: data[0], count: count).map { Float($0) / 32768 })
        } else if let data = pcm.int32ChannelData {
            samples.append(contentsOf: UnsafeBufferPointer(start: data[0], count: count).map { Float($0) / 2_147_483_648 })
        }
    }

    private func finish() {
        guard let continuation else { return }
        self.continuation = nil
        continuation.resume(returning: samples.isEmpty ? nil : SpeechAudio(samples: samples, sampleRate: sampleRate))
    }
}
