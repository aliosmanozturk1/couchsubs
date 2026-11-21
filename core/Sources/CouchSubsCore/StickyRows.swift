// SPDX-License-Identifier: AGPL-3.0-only

import Foundation

/// Konuşma değişirken ekranda sabit duran satırı (görev/HUD yazısı) okumadan çıkarır. GTA 6'da görev yazısı ("Get in
/// the sea plane", "Stash the acid in Brian's lockup") konuşma altyazısının hemen altında, dakikalarca durur; yazı
/// tanıma ikisini tek blok okuyordu ("Thought I was flying solo. Come on.\nGet in the sea plane"). Konuşma kalkıp görev
/// tek başına kalınca kararlayıcı bunu gönderilenin bir satırı eksik okuması sayıyor, TV'de eski konuşmanın çevirisi
/// görev yazısı durdukça kalıyordu; kısa yeni konuşma da uzun görev satırı yüzünden aynı altyazı sayılıp hiç
/// çevrilmiyordu. Bir satır en az `stickyMs` ekranda kaldıysa ve yanında ondan en az `youngerByMs` sonra gelmiş başka
/// bir satır varsa sabit (HUD) sayılır; sabit satır, ekrandan kalkana dek (tek başına kalsa da) okumadan çıkarılır.
/// Satırları birlikte beliren konuşma kutusu (sayfa sayfa okunan diyaloglar) etkilenmez
/// (Windows: StickyRows.cs, Android: StickyRows.kt).
public struct StickyRows {
    /// Satır bu kadar ekranda kalmadan sabit sayılmaz.
    public static let stickyMs = 6000
    /// Yanındaki satırın en az bu kadar sonra gelmiş olması gerekir (birlikte beliren satırlar konuşmadır).
    public static let youngerByMs = 3000
    /// Bu kadar okunmayan satır ekrandan kalkmış sayılır (birkaç karelik okuma kaçağı satırı unutturmaz).
    public static let forgetAfterMs = 1500
    /// Görev satırı henüz sabit sayılmadan da (ilk `stickyMs`) altyazıya karışmasın: okumanın üst ya da alt ucunda duran,
    /// yanındaki en yeni satırdan en az bu kadar önce gelmiş, konuşan adı taşımayan satır bu okumadan çıkarılır.
    /// Kullanıcı bildirimi (GTA 6): görev yazısı ("x yere git") ekrandayken gelen altyazılar ya görevle tek blok gönderiliyor
    /// ya da görev ayrı blok olarak altyazının yerine seçiliyordu; arada diyaloglar kayboluyordu. Yazı yazılır gibi beliren
    /// ikinci satır (yaklaşık 1 sn sonra) bu süreden kısa kalır, konuşma bölünmez. Yaş satırın son büyümesinden sayılır (yazı
    /// yazılır gibi beliren üst satır alt satır gelene dek büyür) ve üst uçtaki satırın altındaki satır onun devamıysa
    /// (`Reading.continues`: cümle bitmemiş, alttaki küçük harfle başlıyor ya da kısa) üst satır çıkarılmaz: iki satırlı
    /// altyazının alt satırı geç belirince üst satır atılıyor, yalnız alttaki 1-2 sözcük çevriliyordu (GitHub #715).
    public static let lingerMs = 1200
    /// Eklenen satır görev sayılmak için ekrandaki en uzun satırın en çok bu kadarı olmalı (görev kısa: "Follow John");
    /// boyları yakınsa hangisinin görev olduğu bilinmez, eski kural uygulanır.
    public static let joinedShare = 0.8

    private struct Row {
        var text: String
        var since: Int
        var lastSeen: Int
        /// Satırın en son büyüdüğü an (yazı yazılır gibi beliren satır).
        var grown: Int
        var sticky = false
        /// Satır, önceki okumanın satırları (en az `lingerMs` durgun, hiçbiri kalkmamış, konuşan adı yok) dururken onların
        /// altına eklendi; konuşan adı taşımıyor, üstteki cümlenin devamı değil ve en uzun satırdan belirgin kısa
        /// (`joinedShare`): eski satır değil bu satır görev yazısıdır. Yanında başka satır oldukça çıkarılır; yanındaki
        /// konuşma eski sayılmaz. Kullanıcı bildirimi (X, beta.69, GTA 6): "John'u takip et" konuşma ekrandayken alta
        /// çıkınca konuşma çevrilmiyordu; `lingerMs` kuralı konuşmayı (eski satır) görev sanıp atıyor, görevi altyazı
        /// olarak gönderiyordu.
        var joined = false
    }

    private var rows: [Row] = []
    /// Önceki `filter` çağrısında okunan satırlar (`rows` dizinleri; silinen satırlar zamanla birlikte düşer).
    private var previous: [Int] = []
    /// Son `filter` çağrısında ilk kez sabit sayılan satırlar (günlük için).
    public private(set) var newlySticky: [String] = []
    /// Son `filter` çağrısında okumadan çıkarılan satırlar (sabit ya da uçta bekleyen; görev satırı).
    public private(set) var removed: [TextLine] = []

    public init() {}

    /// Okumanın sabit (HUD) satırları çıkarılmış hali. `time`: milisaniye saati.
    public mutating func filter(_ reading: Reading, at time: Int) -> Reading {
        newlySticky = []
        var matched: [Int?] = []
        var used = Set<Int>()
        var created: [Int] = []
        for line in reading.lines {
            let text = TextMatch.normalize(line.text)
            guard text.count >= 3 else { matched.append(nil); continue }
            if let index = rows.indices.first(where: { !used.contains($0) && TextMatch.isSimilar(text, rows[$0].text) }) {
                rows[index].lastSeen = time
                if text.count >= rows[index].text.count + 3 {
                    // Satır büyüdü (yazı yazılır gibi): yaşı yeniden başlar; okuma sapmaları (kısalıp uzama) saymaz.
                    rows[index].text = text
                    rows[index].grown = time
                }
                used.insert(index)
                matched.append(index)
            } else {
                rows.append(Row(text: text, since: time, lastSeen: time, grown: time))
                used.insert(rows.count - 1)
                created.append(matched.count)
                matched.append(rows.count - 1)
            }
        }
        let present = matched.compactMap { $0 }
        for position in created { rows[matched[position]!].joined = joins(reading, matched, position, present, at: time) }
        for index in present where !rows[index].sticky && time - rows[index].since >= Self.stickyMs {
            let since = rows[index].since
            if present.contains(where: { rows[$0].since - since >= Self.youngerByMs }) {
                rows[index].sticky = true
                newlySticky.append(reading.lines[matched.firstIndex(of: index)!].text)
            }
        }
        let lingering = lingeringLines(reading, matched)
        let kept = zip(reading.lines, matched).enumerated()
            .filter { position, pair in !lingering[position] && (pair.1.map { !rows[$0].sticky } ?? true) }
            .map(\.element.0)
        removed = zip(reading.lines, matched).enumerated()
            .filter { position, pair in lingering[position] || (pair.1.map { rows[$0].sticky } ?? false) }
            .map(\.element.0)
        // Kalkan satırlar unutulur (dizinler yukarıda kullanıldı; silme en sonda). Önceki okumanın satırları dizin
        // değil satır olarak tutulamadığı için silmeden sonra yeniden bulunur.
        let seen = present.map { rows[$0] }
        rows.removeAll { time - $0.lastSeen > Self.forgetAfterMs }
        previous = seen.compactMap { row in rows.firstIndex { $0.since == row.since && $0.text == row.text } }
        return kept.count == reading.lines.count ? reading : Reading(lines: kept)
    }

    /// Yeni satır (`position`) ekrandaki konuşmanın altına eklenen görev yazısı mı (bkz. `Row.joined`). Yazı yazılır gibi
    /// beliren ikinci satır eklenmiş sayılmaz: üstteki satır az önce büyüyordu ya da yeni satır onun devamı
    /// (`Reading.continues`). Konuşma değişirken gelen satır da sayılmaz: önceki satırlardan biri kalktı.
    private func joins(_ reading: Reading, _ matched: [Int?], _ position: Int, _ present: [Int], at time: Int) -> Bool {
        guard !previous.isEmpty,
              previous.allSatisfy({ present.contains($0) && time - rows[$0].grown >= Self.lingerMs }) else { return false }
        guard !matched[(position + 1)...].contains(where: { $0 != nil }) else { return false }
        let line = reading.lines[position].text
        guard SpeakerPrefix.split(line) == nil else { return false }
        // Konuşan adlı konuşmanın altına gelen satır sıradaki konuşmacının yanıtıdır ("Lucia: Wait for me." / "Okay.").
        guard !(0..<position).contains(where: { matched[$0] != nil && SpeakerPrefix.split(reading.lines[$0].text) != nil })
        else { return false }
        let longest = previous.map { rows[$0].text.count }.max() ?? 0
        guard Double(rows[matched[position]!].text.count) <= Self.joinedShare * Double(longest) else { return false }
        guard let upper = (0..<position).last(where: { matched[$0] != nil }) else { return true }
        return !Reading.continues(reading.lines[upper].text, with: line)
    }

    /// `lingerMs`: okumanın üst ya da alt ucundaki, en yeni satırdan en az o kadar eski satırlar (görev yazısı) ve
    /// konuşmanın altına eklenen satırlar (`Row.joined`). Eklenen satır "en yeni" sayılmaz: konuşmayı eski gösterip
    /// atmasın. Sabit satırlar hesaba katılmaz; konuşan adlı satır hiç çıkarılmaz.
    private func lingeringLines(_ reading: Reading, _ matched: [Int?]) -> [Bool] {
        var result = Array(repeating: false, count: reading.lines.count)
        let live = matched.indices.filter { matched[$0].map { !rows[$0].sticky } ?? false }
        guard live.count >= 2 else { return result }
        let settled = live.filter { !rows[matched[$0]!].joined }
        guard let youngest = (settled.isEmpty ? live : settled).map({ rows[matched[$0]!].since }).max() else { return result }
        func old(_ position: Int) -> Bool {
            let row = rows[matched[position]!]
            return SpeakerPrefix.split(reading.lines[position].text) == nil
                && ((row.joined && !settled.isEmpty) || youngest - row.grown >= Self.lingerMs)
        }
        // Yalnız uçtaki eski satırlar (görev altyazının altında ya da üstünde); ortadaki satır konuşmanın parçasıdır.
        // Üstteki eski satırın altındaki satır onun devamıysa ikisi aynı cümledir: üst satır kalır.
        for (k, position) in live.enumerated() {
            guard old(position) else { break }
            if k + 1 < live.count,
               Reading.continues(reading.lines[position].text, with: reading.lines[live[k + 1]].text) { break }
            result[position] = true
        }
        for position in live.reversed() { if old(position) { result[position] = true } else { break } }
        return result
    }

    public mutating func reset() {
        rows.removeAll()
        previous = []
        newlySticky = []
        removed = []
    }
}
