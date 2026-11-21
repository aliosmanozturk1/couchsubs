// SPDX-License-Identifier: AGPL-3.0-only

// Gerçek kare gerileme koşucusu (scripts/regression-frames.sh çağırır).
//
//   frame-regression run <kare klasörü> [--json <çıktı>] [--core <ad>] [-v]
//       Kareleri gerçek Apple Vision ile okur; altyazı seçimi → sabit sözlük → TV kutusu hattını, telefon/harita
//       sınıflamasını ve telefon çevirisi senaryolarını koşar; özet tablo ve JSON yazar.
//   frame-regression record <kare klasörü>
//       Her karenin altyazı alanındaki Vision okumasını <klasör>/ocr/<id>.json'a yazar (Android ve Windows aynı
//       okumalarla kendi seçim mantığını koşar).
//   frame-regression ocr <resim> [sol,üst,sağ,alt]
//       Etiketleme yardımı: bütün karenin (ya da alanın) satırları kutularıyla, telefon ve harita kartı.

@testable import CouchSubsCore
import CoreGraphics
import Foundation

@main
struct Main {
    @MainActor
    static func main() async {
        var arguments = Array(CommandLine.arguments.dropFirst())
        guard let command = arguments.first else { usage() }
        arguments.removeFirst()
        do {
            switch command {
            case "run": try await run(arguments)
            case "record": try record(arguments)
            case "ocr": try ocr(arguments)
            default: usage()
            }
        } catch {
            FileHandle.standardError.write("hata: \(error.localizedDescription)\n".data(using: .utf8)!)
            exit(2)
        }
    }

    static func usage() -> Never {
        print("kullanım: frame-regression run <klasör> [--json <dosya>] [--core <ad>] [-v] | record <klasör> | ocr <resim> [l,t,r,b]")
        exit(64)
    }

    static func option(_ name: String, in arguments: [String]) -> String? {
        guard let at = arguments.firstIndex(of: name), at + 1 < arguments.count else { return nil }
        return arguments[at + 1]
    }

    @MainActor
    static func run(_ arguments: [String]) async throws {
        guard let path = arguments.first else { usage() }
        let runner = try Runner(directory: URL(fileURLWithPath: path), verbose: arguments.contains("-v"))
        let summary = await runner.run(core: option("--core", in: arguments) ?? "bu çekirdek")
        Report.print(summary)
        if let out = option("--json", in: arguments) {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try encoder.encode(summary).write(to: URL(fileURLWithPath: out))
        }
    }

    static func record(_ arguments: [String]) throws {
        guard let path = arguments.first else { usage() }
        let directory = URL(fileURLWithPath: path)
        let manifest = try Manifest.load(directory)
        let out = directory.appendingPathComponent("ocr")
        try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let reader = VisionReader(language: "en")
        for frame in manifest.frames {
            guard let image = Images.load(directory.appendingPathComponent(frame.file)) else { continue }
            let region = frame.cropRegion
            let reading = try reader.readLines(RegionCropper.crop(image, to: region), deep: false)
            let fixture = OcrFixture(id: frame.id, region: [region.left, region.top, region.right, region.bottom],
                                     lines: reading.lines.map(OcrFixture.Line.init))
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try encoder.encode(fixture).write(to: out.appendingPathComponent("\(frame.id).json"))
        }
        print("\(manifest.frames.count) karenin okuması \(out.path) klasörüne yazıldı")
    }

    static func ocr(_ arguments: [String]) throws {
        guard let path = arguments.first, let image = Images.load(URL(fileURLWithPath: path)) else { usage() }
        var target = image
        if arguments.count > 1 {
            let values = arguments[1].split(separator: ",").compactMap { Double($0) }
            if values.count == 4 {
                target = RegionCropper.crop(image, to: CropRegion(top: values[1], bottom: values[3], left: values[0], right: values[2]))
            }
        }
        let reading = try VisionReader(language: "en").readLines(target, deep: false)
        print("\(image.width)x\(image.height)")
        for line in reading.lines {
            let b = line.box ?? TextBox(left: 0, top: 0, right: 0, bottom: 0)
            print(String(format: "[%.3f %.3f %.3f %.3f] c=%.2f  %@", b.left, b.top, b.right, b.bottom, line.confidence ?? -1, line.text))
        }
        if let handset = ScreenPhoneCard.phone(in: image) {
            let groups = ScreenTranslation.groups(reading, frame: image, wholeScreen: true, handset: handset)
            print("telefon: " + groups.compactMap { group in group.phone.map { "\($0.role.rawValue)=\(group.paragraphs.joined(separator: " / "))" } }
                .joined(separator: " | "))
        } else {
            print("telefon: yok")
        }
        let lines = reading.lines.filter { $0.box != nil }
        let cards = MissionCard.find(lines).filter { MissionCard.onPanel(image, $0.all.map { lines[$0] }) }
        print("harita kartı: \(cards.isEmpty ? "yok" : cards.map { $0.title.map { lines[$0].text }.joined(separator: " ") }.joined(separator: ", "))")
    }
}

enum Report {
    static func print(_ summary: Summary) {
        func row(_ name: String, _ metric: Summary.Metric, lowerIsBetter: Bool = false) -> String {
            let shown = lowerIsBetter ? metric.total - metric.passed : metric.passed
            return String(format: "  %-34@ %3d/%-3d  %%%5.1f", name as NSString, shown, metric.total,
                          (lowerIsBetter ? 1 - metric.rate : metric.rate) * 100)
        }
        Swift.print("Gerçek kare gerileme seti — \(summary.core) (\(summary.frames.count) kare)")
        Swift.print(row("Altyazı satırı yakalama", summary.capture))
        Swift.print(row("Yanlış kabul (tabela/altyazısız)", summary.falseAccept, lowerIsBetter: true))
        Swift.print(row("Telefon sınıflama", summary.phone))
        Swift.print(row("Harita kartı sınıflama", summary.map))
        Swift.print(row("Çizim kutusu örtme (piksel ≥%95)", summary.cover))
        Swift.print(row("Telefon çevirisi gösteriliyor", summary.phoneTranslation))
        Swift.print(row("Ekran yazısı (menü, görev listesi)", summary.screen))
        let misses = summary.frames.filter { $0.captured == false || $0.falseAccept == false || $0.phoneExpected != $0.phoneDetected
            || $0.mapExpected != $0.mapDetected || ($0.coverage.map { $0 < coverPass } ?? false) || $0.screen == false }
        for frame in misses {
            var notes: [String] = []
            if frame.captured == false { notes.append("altyazı yakalanmadı (beklenen \"\(frame.expected ?? "")\", giden \(frame.sent))") }
            if frame.falseAccept == false { notes.append("yanlış kabul \(frame.sent)") }
            if frame.phoneExpected != frame.phoneDetected { notes.append("telefon \(frame.phoneExpected) ≠ \(frame.phoneDetected)") }
            if frame.mapExpected != frame.mapDetected { notes.append("harita kartı \(frame.mapExpected) ≠ \(frame.mapDetected)") }
            if let coverage = frame.coverage, coverage < coverPass { notes.append(String(format: "kutu örtmüyor (%%%.0f)", coverage * 100)) }
            if frame.screen == false { notes.append("ekran yazısı: " + (frame.screenNotes ?? []).joined(separator: "; ")) }
            Swift.print("    ✗ \(frame.id): " + notes.joined(separator: "; "))
        }
        for scenario in summary.scenarios where !scenario.passed {
            Swift.print("    ✗ telefon senaryosu \(scenario.name): \(scenario.detail)")
        }
    }
}

/// testdata/frames/ocr/<id>.json: altyazı alanının Vision okuması (kutular alana oranla). Android ve Windows testleri
/// kendi seçim mantığını bu okumalarla koşar.
struct OcrFixture: Encodable {
    struct Word: Encodable { var text: String; var box: [Double] }
    struct Line: Encodable {
        var text: String
        var box: [Double]?
        var confidence: Double?
        var words: [Word]?

        init(_ line: TextLine) {
            text = line.text
            box = line.box.map(OcrFixture.rounded)
            confidence = line.confidence.map { ($0 * 1000).rounded() / 1000 }
            words = line.words?.map { Word(text: $0.text, box: OcrFixture.rounded($0.box)) }
        }
    }
    var id: String
    var region: [Double]
    var lines: [Line]

    static func rounded(_ box: TextBox) -> [Double] {
        [box.left, box.top, box.right, box.bottom].map { ($0 * 100_000).rounded() / 100_000 }
    }
}
