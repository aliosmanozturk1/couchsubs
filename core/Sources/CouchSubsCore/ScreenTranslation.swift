// SPDX-License-Identifier: AGPL-3.0-only

import CoreGraphics
import Foundation

/// "Ekranı çevir": karenin tamamı bir kez okunur, yazılar yerlerine göre gruplara ayrılır (menü, görev paneli, bilgi
/// kutusu, altyazı...) ve her grup ayrı çevrilir. TV her çeviriyi kendi İngilizce yazısının üstüne, o yazının
/// boyutunda koyar (Windows: CouchSubs.Core/ScreenTranslation.cs ile aynı kurallar).
public enum ScreenTranslation {
    /// Ekrandaki bir yazı grubu.
    public struct Group: Equatable, Sendable {
        /// Ayrı ayrı çevrilecek parçalar (başlık, cümle, menü satırı...).
        public var paragraphs: [String]
        /// Karedeki yeri, kenarlara oranla.
        public var box: TextBox
        /// Satırlarının tipik yüksekliği, karenin yüksekliğine oranla; TV yazı boyunu buna göre seçer.
        public var lineHeight: Double
        /// Her parçadaki kumanda simgeleri, parçadaki `ButtonIcons.marker` sırasıyla; simge yoksa nil.
        public var icons: [[IconSlot]]? = nil
        /// GTA 6 telefonunun ekranındaki grubun rolü ve düz ekrandaki yeri (`PhoneChat`); telefon dışındaysa nil.
        var phone: ScreenPhoneCard.Placement? = nil
    }

    public struct Item: Equatable, Sendable {
        public var source: String
        /// Parçaların çevirisi, her parça ayrı satırda.
        public var translation: String
        public var box: TextBox
        public var lineHeight: Double
        /// Çevirinin içindeki kumanda simgeleri (kareden kesilmiş); TV `translation`'ın o yerine koyar.
        public var icons: [IconPlacement]?
        public var style: PhoneTextStyle?
        /// Özgün yazının görünüşü (otomatik ekran yazısı ve "Ekranı çevir"); TV ve masaüstü çeviriyi bu stilde çizer.
        public var look: TextLook?
        /// Çevirisi aslıyla aynı (ad, "ok"): yalnız telefon kartında gösterilir, başka yerde atılır (`ScreenPhoneCard`).
        var unchanged = false
        /// Telefondaki yazının rolü ve düz ekrandaki yeri; kart bunlarla dizilir (`ScreenPhoneCard.layout`).
        var phone: ScreenPhoneCard.Placement?

        public init(source: String, translation: String, box: TextBox, lineHeight: Double, icons: [IconPlacement]? = nil) {
            self.source = source
            self.translation = translation
            self.box = box
            self.lineHeight = lineHeight
            self.icons = icons
        }

        /// Birden çok parça var: TV satır satır, sola yaslı gösterir.
        public var paragraphs: Bool { translation.contains("\n") }
    }

    /// Kalabalık ekranda TV'yi kutuyla doldurmamak ve çeviriyi uzatmamak için en çok bu kadar grup çevrilir; fazlası
    /// olunca en az yazısı olanlar (tek sözcüklük etiketler) bırakılır.
    public static let maxGroups = 30

    /// Grupları sırayla çevirir; her grup çevrilince o ana kadarki sonuçlarla `progress` çağrılır. Çevirisi aslıyla
    /// aynı olan (ad, sayı, zaten Türkçe yazı) grup gösterilmez. `frame` okunan kareyse yazıların içindeki kumanda
    /// simgeleri ondan kesilip çeviriye konur; simgelerin yeri çeviride uydurma adlarla korunur (`IconText`).
    ///
    /// Kare verilince her çeviri özgün yazının stilinde (zemin ve yazı rengi, kalınlık, hiza, BÜYÜK HARF; otomatik ekran
    /// yazısıyla aynı, `TextStyleSampler`) kendi kutusunun yerine çizilir; karede GTA 6 telefonu varsa telefonun yazıları
    /// yanında bir mesaj kartında dizilir (`ScreenPhoneCard`). `memory` verilirse çeviriler (telefon mesajları sohbetin
    /// başlığıyla) saklanır; aynı sohbete dönünce ya da kart yenilenince çevirmene gitmez (`PhoneChatMemory`). `handset`:
    /// karesiz sınamalar için.
    public static func translate(_ reading: Reading, using translate: (String) async throws -> String,
                                 frame: CGImage? = nil, memory: PhoneChatMemory? = nil, handset: ScreenPhoneCard.Handset? = nil,
                                 progress: ([Item]) -> Void = { _ in }) async throws -> [Item] {
        let phone = handset ?? frame.flatMap(ScreenPhoneCard.phone(in:))
        var items: [Item] = []
        let all = withImages(groups(reading, frame: frame, wholeScreen: true, handset: phone), from: frame)
        let chat = chatTitle(all)
        for group in all {
            try Task.checkCancellation()
            let prepared = group.paragraphs.map(IconText.protect)
            var translated: [String] = []
            for (index, paragraph) in prepared.enumerated() {
                let source = group.paragraphs[index]
                if let known = known(source, in: group) ?? remembered(source, in: group, chat: chat, memory: memory) {
                    translated.append(known)
                    continue
                }
                let prices = PriceText.protect(paragraph.text)
                let result = PriceText.restore(try await translate(prices.text), prices.values)
                memory?.remember(chat: memoryChat(group, chat), source: source, translation: result)
                translated.append(result)
            }
            guard let item = item(group, prepared, translated, keepUnchanged: phone != nil) else { continue }
            items.append(styled(item, frame: frame))
            let shown = present(items, phone: phone)
            if !shown.isEmpty { progress(shown) }
        }
        return present(items, phone: phone)
    }

    /// Çevirmen parçaları tek istekte çevirebiliyorsa (yapay zekâ) ekranın bütün parçaları birlikte gider ve sonuç bir
    /// kerede gelir; yoksa gruplar sırayla çevrilip hazırlandıkça bildirilir. `frame`: bkz. yukarıdaki `translate`.
    public static func translate(_ reading: Reading, using translator: TextTranslator, frame: CGImage? = nil,
                                 memory: PhoneChatMemory? = nil, handset: ScreenPhoneCard.Handset? = nil,
                                 progress: ([Item]) -> Void = { _ in }) async throws -> [Item] {
        guard translator.translatesTogether else {
            return try await translate(reading, using: { try await translator.translate($0) }, frame: frame, memory: memory,
                                       handset: handset, progress: progress)
        }
        let phone = handset ?? frame.flatMap(ScreenPhoneCard.phone(in:))
        let groups = withImages(groups(reading, frame: frame, wholeScreen: true, handset: phone), from: frame)
        let prepared = groups.map { group in group.paragraphs.map(IconText.protect) }
        let chat = chatTitle(groups)
        // Sözlükteki kısa arayüz etiketleri ("SCROLL", "SEND", "BACK") ve telefondaki kişi adları çevirmene gitmez;
        // daha önce görülen sohbetin mesajları da (`memory`); fiyatlar adla korunur.
        let sources = groups.flatMap(\.paragraphs)
        let owners = groups.flatMap { group in group.paragraphs.map { _ in group } }
        let knowns = sources.indices.map { known(sources[$0], in: owners[$0]) ?? remembered(sources[$0], in: owners[$0], chat: chat, memory: memory) }
        let prices = prepared.flatMap { list in list.map { PriceText.protect($0.text) } }
        let asked = prices.indices.filter { knowns[$0] == nil }
        guard !sources.isEmpty else { return [] }
        let answers = asked.isEmpty ? [] : try await translator.translateAll(asked.map { prices[$0].text })
        try Task.checkCancellation()
        var translations = knowns.map { $0 ?? "" }
        for (k, index) in asked.enumerated() where k < answers.count {
            translations[index] = PriceText.restore(answers[k], prices[index].values)
            memory?.remember(chat: memoryChat(owners[index], chat), source: sources[index], translation: translations[index])
        }
        var items: [Item] = []
        var next = 0
        for (index, group) in groups.enumerated() {
            let count = group.paragraphs.count
            let translated = (next..<next + count).map { $0 < translations.count ? translations[$0] : "" }
            next += count
            if let item = item(group, prepared[index], translated, keepUnchanged: phone != nil) {
                items.append(styled(item, frame: frame))
            }
        }
        let shown = present(items, phone: phone)
        if !shown.isEmpty { progress(shown) }
        return shown
    }

    /// Oyun arayüzü sözlüğündeki kısa etiketin Türkçesi ("SCROLL" → "KAYDIR", "TIP" → "BAHŞİŞ VER"); simgeli ya da
    /// sözlükte olmayan parçada nil (çevirmene gider).
    static func known(_ paragraph: String, in group: Group? = nil) -> String? {
        // Telefondaki kişi adı (sohbet başlığı, listedeki ad) çevrilmez: "Rose" "Gül", "May" "Mayıs" olmasın.
        if group?.phone?.role.keepsText == true { return paragraph }
        guard !paragraph.contains(ButtonIcons.marker) else { return nil }
        return UiCommands.translateLabel(paragraph)
    }

    /// Telefondaki sohbetin başlığı (kişi adı); sohbet listesinde ya da telefonsuz karede boş.
    static func chatTitle(_ groups: [Group]) -> String {
        groups.first { $0.phone?.role == .header }?.paragraphs.first ?? ""
    }

    /// Hafızadaki yeri: telefon mesajı sohbetin başlığıyla, telefon dışındaki yazı (görev, menü) başlıksız saklanır.
    static func memoryChat(_ group: Group, _ chat: String) -> String { group.phone == nil ? "" : chat }

    /// Bu sohbette (telefon dışındaki yazıda: bu ekranda) daha önce çevrilmiş parçanın çevirisi (`PhoneChatMemory`).
    static func remembered(_ paragraph: String, in group: Group, chat: String, memory: PhoneChatMemory?) -> String? {
        memory?.translation(chat: memoryChat(group, chat), of: paragraph)
    }

    /// Öğeye özgün yazının görünüşü: zemin ve yazı rengi, kalınlık, dar yazı, hiza; özgün yazı BÜYÜK HARFse çeviri de
    /// büyütülür. Önceden "Ekranı çevir" her yazıyı aynı siyah kutuda gösteriyordu, otomatik ekran yazısı ise özgün
    /// stilde; kullanıcılar çevirinin "ayrı bir kutuda" durduğunu söylüyordu.
    static func styled(_ item: Item, frame: CGImage?) -> Item {
        guard let frame else { return item }
        var styled = item
        let (surface, look) = TextStyleSampler.sample(frame, box: item.box, lines: [], source: item.source)
        styled.style = surface
        styled.look = look
        if look.upper { styled.translation = TextStyleSampler.turkishUpper(item.translation) }
        return styled
    }

    /// Gösterilecek öğeler: telefon varsa kartı dizilir; çevirisi aslıyla aynı öğeler (kart dışında) atılır.
    static func present(_ items: [Item], phone: ScreenPhoneCard.Handset?) -> [Item] {
        let laid = phone.map { ScreenPhoneCard.layout(items, handset: $0) } ?? items
        return withoutDuplicates(laid.filter { !$0.unchanged })
    }

    // MARK: - Aynı yerde tek çizim (#827)

    /// Aynı okumada iki satırın (ya da iki öğenin) kutusu küçüğünün alanının en az bu kadarı kadar örtüşüyorsa aynı yazının
    /// iki okunuşudur; yalnız harfi çok olanı kalır.
    public static let duplicateShare = 0.5
    /// Ayrı yollardan gelen iki çevirinin ("Ekranı çevir", otomatik ekran yazısı, ek alan) kutusu küçüğünün alanının en az bu
    /// kadarı kadar örtüşüyorsa aynı yazıyı çiziyorlardır; yalnız biri çizilir. Önceden GTA 6 haritasında ikisi üst üste
    /// çiziliyor, alttakinin yazısı üsttekinin arasından görünüyordu.
    public static let coverShare = 0.25

    /// İki kutunun kesişiminin küçük kutunun alanına oranı (0…1).
    public static func overlap(_ a: TextBox, _ b: TextBox) -> Double {
        let width = min(a.right, b.right) - max(a.left, b.left)
        let height = min(a.bottom, b.bottom) - max(a.top, b.top)
        guard width > 0, height > 0 else { return 0 }
        let smaller = min((a.right - a.left) * (a.bottom - a.top), (b.right - b.left) * (b.bottom - b.top))
        return smaller > 0 ? min(1, width * height / smaller) : 0
    }

    private static func letters(_ text: String) -> Int { text.filter(\.isLetter).count }

    /// Aynı yazının iki okunuşundan (yazı tanıma bir satırı hem bütün hem parça okuyabiliyor) yalnız harfi çok olanı kalır;
    /// eşitse önce gelen. Sıra korunur. Önceden ikisi ayrı çevrilip üst üste çiziliyordu ("Donnie'nin Paketini Bul" altında
    /// "Bulur").
    public static func withoutDuplicateLines(_ lines: [TextLine]) -> [TextLine] {
        let counts = lines.map { letters($0.text) }
        return lines.indices.filter { i in
            guard let box = lines[i].box else { return true }
            return !lines.indices.contains { j in
                guard j != i, let other = lines[j].box, overlap(box, other) >= duplicateShare else { return false }
                return counts[j] > counts[i] || (counts[j] == counts[i] && j < i)
            }
        }.map { lines[$0] }
    }

    /// Satırın başındaki ya da sonundaki simge kırıntısı (menüdeki harita/dükkân/ayar simgesi yazı tanımada "<", "©",
    /// "@" ya da baştaki tek harf olarak okunur) satırdan atılır; kutu yalnız yazının sözcüklerini kapsar (#827). Önceden
    /// çeviri kutusu simgeyi de örtüyordu. Sözcük yerleri bilinmiyorsa harf sayısına göre kestirilir. Kumanda simgeli
    /// satıra (simge çeviride yerinde gösterilir), sayıya, noktalamaya ve geriye iki harf kalmayacaksa dokunulmaz.
    public static func withoutEdgeMarks(_ line: TextLine) -> TextLine {
        guard (line.icons ?? []).isEmpty, !line.text.contains(ButtonIcons.marker), let box = line.box else { return line }
        let measured = !(line.words ?? []).isEmpty
        let words = measured ? line.words! : ButtonIcons.estimate(line.text, box)
        var start = 0, end = words.count
        while start < end - 1, isEdgeMark(words[start].text, leading: true) { start += 1 }
        while end - 1 > start, isEdgeMark(words[end - 1].text, leading: false) { end -= 1 }
        guard start > 0 || end < words.count else { return line }
        let kept = Array(words[start..<end])
        guard kept.reduce(0, { $0 + letters($1.text) }) >= 2 else { return line }
        var trimmed = line
        trimmed.text = kept.map(\.text).joined(separator: " ")
        trimmed.box = TextBox(left: start > 0 ? kept[0].box.left : box.left, top: box.top,
                              right: end < words.count ? kept[kept.count - 1].box.right : box.right, bottom: box.bottom)
        trimmed.words = measured ? kept : nil
        return trimmed
    }

    /// Yalnız noktalamadan oluşan parça simge değildir ("...", "-").
    private static let punctuation = Set(".,!?…:;-–—'\"’”")

    /// Kumanda tuşu yazısı ("(✕)", "△", "R1"): kontrol şemasında etiketin parçasıdır, çeviride de yazılır; atılmaz.
    private static let buttonGlyphs = Set("✕×△○□◯⨯")

    /// Simge kırıntısı mı: harfi ve rakamı yok ve yalnız noktalama ya da kumanda tuşu değil ("<", "©", "@"); satır başında
    /// tek harf de ("G Settings"; "a", "A", "I" sözcüktür).
    static func isEdgeMark(_ word: String, leading: Bool) -> Bool {
        let core = word.trimmingCharacters(in: CharacterSet(charactersIn: "()[]{}"))
        if word.contains(where: \.isNumber) || word.contains(where: { buttonGlyphs.contains($0) })
            || ButtonIcons.isButtonName(core) || (word.count > 1 && word.first == "(" && word.last == ")") { return false }
        if !word.contains(where: \.isLetter) { return !word.allSatisfy { punctuation.contains($0) } }
        return leading && word.count == 1 && !["a", "A", "I"].contains(word)
    }

    /// Telefon kartının parçası (zemin, balon, başlık): kart bilerek üst üste dizilir, çakışma kuralına girmez.
    static func isCardPart(_ item: Item) -> Bool { item.phone != nil || ScreenPhoneCard.isBackdrop(item) }

    /// Aynı okumanın öğelerinden aynı yeri çizenlerin yalnız harfi çok olanı kalır (`duplicateShare`); kart dokunulmaz.
    static func withoutDuplicates(_ items: [Item]) -> [Item] {
        let counts = items.map { letters($0.source) }
        return items.indices.filter { i in
            isCardPart(items[i]) || !items.indices.contains { j in
                guard j != i, !isCardPart(items[j]), overlap(items[i].box, items[j].box) >= duplicateShare else { return false }
                return counts[j] > counts[i] || (counts[j] == counts[i] && j < i)
            }
        }.map { items[$0] }
    }

    /// Katmanlar tek listede: sonra gelen öğe, kendisiyle çakışan (`coverShare`) önceki öğelerin yerine geçer (yeni olan
    /// eskisini değiştirir). Telefon kartının parçaları dokunulmaz.
    public static func layered(_ items: [Item]) -> [Item] {
        var result: [Item] = []
        for item in items {
            if !isCardPart(item) {
                result.removeAll { !isCardPart($0) && overlap($0.box, item.box) >= coverShare }
            }
            result.append(item)
        }
        return result
    }

    /// `items`'tan `top` öğelerinden biriyle çakışanlar (`coverShare`) atılır: "Ekranı çevir" ekrandayken onun yazılarının
    /// yerindeki otomatik ekran yazısı ve ek alan kutuları çizilmez.
    public static func uncovered(_ items: [Item], by top: [Item]) -> [Item] {
        items.filter { item in !top.contains { overlap(item.box, $0.box) >= coverShare } }
    }

    /// Ekranın yazılarının izi: tuşa yeniden basınca ekranın değişip değişmediği buna bakılarak anlaşılır (`isSameScreen`).
    public static func fingerprint(_ reading: Reading) -> String {
        TextMatch.normalize(groups(reading).flatMap(\.paragraphs).map(IconText.plain).joined(separator: " "))
    }

    /// İki iz aynı ekranın mı. Çeviriler ekrandayken tuşa yeniden basmak önceden hep onları kaldırıyordu: telefonda başka
    /// bir sohbete geçip basınca yeni sohbet çevrilmiyor, ekran boşalıyordu. Artık ekran değiştiyse yeni kare çevrilir,
    /// değişmediyse çeviriler kalkar (Windows ve Android ile aynı).
    /// Aynı ekranın iki okuması en az bu kadar benzer; yeni bir mesajın eklenmesi bile ekranı "değişmiş" yapar.
    public static let sameScreenSimilarity = 0.95

    public static func isSameScreen(_ a: String, _ b: String) -> Bool {
        if a.isEmpty || b.isEmpty { return a == b }
        return TextMatch.isSimilar(a, b, threshold: sameScreenSimilarity)
    }

    /// Simgelerin resimleri kareden kesilir; kare yoksa gruplar olduğu gibi kalır (simge okunan haliyle yazılır).
    static func withImages(_ groups: [Group], from frame: CGImage?) -> [Group] {
        guard let frame else { return groups }
        return groups.map { group in
            guard let icons = group.icons else { return group }
            var cut = group
            cut.icons = icons.map { ButtonIcons.withImages($0, frame: frame) }
            return cut
        }
    }

    /// Grubun gösterilecek çevirisi; çevirisi aslıyla aynıysa (ad, sayı, zaten Türkçe yazı) nil. Boş çeviride parçanın
    /// aslı gösterilir; simgeler TV'de çevirinin içindeki yerlerine konur.
    static func item(_ group: Group, _ prepared: [IconText.Protected], _ translations: [String],
                     keepUnchanged: Bool = false) -> Item? {
        var changed = false
        var texts: [String] = []
        var slots: [IconSlot] = []
        for (index, paragraph) in group.paragraphs.enumerated() {
            let translated = (index < translations.count ? translations[index] : "").trimmingCharacters(in: .whitespacesAndNewlines)
            let text = translated.isEmpty ? IconText.indexed(paragraph, offset: slots.count)
                : IconText.restore(translated, names: index < prepared.count ? prepared[index].names : [], offset: slots.count)
            changed = changed || !TextMatch.isSimilar(TextMatch.normalize(IconText.plain(paragraph)),
                                                      TextMatch.normalize(IconText.plain(text)), threshold: 0.90)
            texts.append(text)
            if let all = group.icons, index < all.count { slots += all[index] }
        }
        guard changed || keepUnchanged else { return nil }
        let rendered = IconText.render(texts.joined(separator: "\n"), slots: slots)
        var item = Item(source: group.paragraphs.map(IconText.plain).joined(separator: "\n"), translation: rendered.text,
                        box: group.box, lineHeight: group.lineHeight, icons: rendered.icons.isEmpty ? nil : rendered.icons)
        item.unchanged = !changed
        item.phone = group.phone
        return item
    }

    /// Satırları gruplara toplar. Yazının içindeki kumanda simgeleri işaretlenir (`ButtonIcons`); kumanda ipuçları ve
    /// yazı tanıma çöpleri atılır; harfi olmayan ya da tek harfli satırlar ("23m", "9", "+") göstergedir, çevrilmez. Bir
    /// satır, üstündeki satırın hemen altındaysa, yatayda onunla üst üste biniyorsa ve yazı boyu benziyorsa o gruba
    /// katılır; küçük harfle başlayan satır üstteki bitmemiş cümleye katılır (`continues`). Gruplar yukarıdan aşağı; en çok
    /// `maxGroups`, en çok yazısı olanlar.
    ///
    /// `wholeScreen` ("Ekranı çevir"): yazı tanımanın bozduğu fiyatlar düzelir (`PriceText.repair`) ve tuş çubukları
    /// atılmaz, etiketlerine bölünür (`promptPieces`): tuş simgeleri ve fiyatlar çeviriye girmez, ekranda görünür kalır;
    /// aynı satırdaki her seçenek kendi kutusunda çevrilir, çeviriler üst üste binmez.
    ///
    /// `handset`: karede GTA 6 telefonu varsa ekranındaki satırlar ayrı gruplanır (`PhoneChat`: balon, başlık, liste).
    public static func groups(_ reading: Reading, frame: CGImage? = nil, keepIdentifiers: Bool = false,
                              wholeScreen: Bool = false, handset: ScreenPhoneCard.Handset? = nil) -> [Group] {
        var marked = (wholeScreen ? Reading(lines: reading.lines.map(repaired)) : reading).withButtonIcons()
        if wholeScreen {
            marked = Reading(lines: marked.lines.flatMap { line -> [TextLine] in
                guard (line.icons ?? []).isEmpty, line.box != nil,
                      ButtonPrompts.isPrompt(line.text) || hasWideGap(line) else { return [line] }
                return promptPieces(line)
            })
        }
        // Tam ekranda yalnız aksi halde atılacak kısa ipuçlarında simgeyi görüntüden doğrula.
        if let frame {
            marked = Reading(lines: marked.lines.map { line in
                (line.icons ?? []).isEmpty && ButtonPrompts.isPrompt(line.text) ? ButtonIcons.markFree(line, frame: frame) : line
            })
        }
        let lines = marked.withoutButtonPrompts().withoutOcrNoise(keepIdentifiers: keepIdentifiers).lines
            .filter { $0.box != nil && isWords($0.text) }
            // Aynı satırdaki parçalar (tuş çubuğunun etiketleri) soldan sağa; sıralama kararlı değildir.
            .sorted { $0.box!.top != $1.box!.top ? $0.box!.top < $1.box!.top : $0.box!.left < $1.box!.left }
        // "Ekranı çevir": haritanın görev kartı kendi parçalarına ayrılır (başlık, açıklama, ayrıntılar; `MissionCard`).
        // Aynı yazının iki okunuşu tek satır kalır; satırın başındaki/sonundaki simge kutunun dışında kalır (#827).
        // Telefonun satırları girmez: eğik telefonda kutuları bilerek üst üste.
        let plain = { (all: [TextLine]) -> [Group] in
            let lines = withoutDuplicateLines(all.map(withoutEdgeMarks))
            return wholeScreen ? withMissionCards(lines, frame: frame) : groups(from: lines)
        }
        guard let handset else { return plain(lines) }
        let onPhone = lines.filter { PhoneChat.onScreen(handset.flat($0.box!)) }
        guard !onPhone.isEmpty else { return plain(lines) }
        // Süzülmemiş satırlar da gider: harfsiz hava durumu satırı ("76°") ana ekranı belli eder.
        let raw = reading.lines.filter { $0.box.map { PhoneChat.onScreen(handset.flat($0)) } ?? false }
        return plain(lines.filter { !PhoneChat.onScreen(handset.flat($0.box!)) }) + PhoneChat.groups(onPhone, handset: handset, raw: raw)
    }

    /// Satırlardaki görev kartları kendi gruplarıyla (kare varsa yalnız düz panelin üstündekiler), kalanlar her zamanki
    /// gibi. Kart tanınmadan başlık açıklamanın ilk cümlesine katılıyor, beş-altı sözcüklük başlık cümleyle birlikte
    /// çevriliyordu.
    static func withMissionCards(_ lines: [TextLine], frame: CGImage?) -> [Group] {
        let cards = MissionCard.find(lines).filter { card in frame.map { MissionCard.onPanel($0, card.all.map { lines[$0] }) } ?? true }
        guard !cards.isEmpty else { return groups(from: lines) }
        let taken = Set(cards.flatMap(\.all))
        let rest = lines.indices.filter { !taken.contains($0) }.map { lines[$0] }
        return (groups(from: rest) + cards.flatMap { MissionCard.groups($0, lines) }).sorted { $0.box.top < $1.box.top }
    }

    /// Satırın ve sözcüklerinin fiyat düzeltmesi (uzunluk değişmez).
    static func repaired(_ line: TextLine) -> TextLine {
        var fixed = line
        fixed.text = PriceText.repair(line.text)
        fixed.words = line.words?.map { TextWord(PriceText.repair($0.text), box: $0.box) }
        return fixed
    }

    /// Tuş çubuğunun etiketleri: tuş adları ve simgeleri ("R1", "△", okunmuş "X"/"O"), fiyatlar ("$10") ve harfsiz
    /// parçalar ayırıcıdır, çeviriye girmez; aralarındaki her sözcük öbeği ayrı satır olur, kutusu sözcüklerinin yeri.
    /// Sözcük yerleri biliniyorsa geniş boşluk da ayırır ("TIP $10   ORDER   BARTENDER"). İki harfi olmayan öbek atılır.
    static func promptPieces(_ line: TextLine) -> [TextLine] {
        guard let box = line.box else { return [line] }
        let measured = !(line.words ?? []).isEmpty
        let words = measured ? line.words! : ButtonIcons.estimate(line.text, box)
        let gap = measured ? wideGap(words) : .infinity
        var runs: [[TextWord]] = [[]]
        for word in words {
            if isPromptSeparator(word.text) {
                runs.append([])
                continue
            }
            if let last = runs[runs.count - 1].last, word.box.left - last.box.right > gap { runs.append([]) }
            runs[runs.count - 1].append(word)
        }
        return runs.filter { run in run.reduce(0) { $0 + $1.text.filter(\.isLetter).count } >= 2 }.map { run in
            let span = run.dropFirst().reduce(run[0].box) { $0.union($1.box) }
            return TextLine(run.map(\.text).joined(separator: " "),
                            box: TextBox(left: span.left, top: box.top, right: span.right, bottom: box.bottom),
                            confidence: line.confidence, words: run)
        }
    }

    /// Sözcüklerin arasında bu kadar boşluk (harf başına ortalama genişliğin üç katı) ayrı seçenek demektir.
    private static func wideGap(_ words: [TextWord]) -> Double {
        let chars = words.reduce(0) { $0 + $1.text.count }
        guard chars > 0 else { return .infinity }
        return words.reduce(0.0) { $0 + ($1.box.right - $1.box.left) } / Double(chars) * 3
    }

    /// Sözcük yerleri bilinen satırda aynı satıra düşmüş ayrı seçenekler var mı (geniş boşluk).
    static func hasWideGap(_ line: TextLine) -> Bool {
        guard let words = line.words, words.count >= 2 else { return false }
        let gap = wideGap(words)
        return zip(words, words.dropFirst()).contains { $1.box.left - $0.box.right > gap }
    }

    /// Tuş çubuğunda çeviriye girmeyen parça: tuş adı/simgesi, tek harf (okunmuş simge), fiyat ya da harfsiz parça.
    static func isPromptSeparator(_ word: String) -> Bool {
        let core = word.trimmingCharacters(in: CharacterSet(charactersIn: "()[]{}<>"))
        return ButtonIcons.isButtonName(core) || PriceText.isMoney(core) || !core.contains(where: \.isLetter)
            || (core.count == 1 && core != "a")
    }

    /// Kutuları bilinen, süzülmüş ve sıralı satırları yeniden işaretlemeden gruplar.
    static func groups(from lines: [TextLine]) -> [Group] {
        var groups: [[TextLine]] = []
        for line in lines {
            if let index = groups.lastIndex(where: { belongs(line.box!, below: $0.last!.box!) }),
               !bridgesColumns(groups[index].last!.box!, line.box!, lines),
               !bridgesColumns(line.box!, groups[index].last!.box!, lines) {
                groups[index].append(line)
            } else if let index = groups.lastIndex(where: { continues(line, above: $0.last!) }) {
                // Küçük harfle başlayan satır, üstündeki bitmemiş cümlenin devamıdır: satır aralığı biraz geniş ya da
                // yanında başka bir yazı olsa da o gruba katılır. Ayrı grup olunca yarım cümle tek başına çevriliyor ya da
                // grup sınırına takılıp hiç çevrilmiyordu; bilgi kutusunun son satırı İngilizce kalıyordu.
                groups[index].append(line)
            } else {
                groups.append([line])
            }
        }
        return busiest(groups).map { group in
            let heights = group.map { $0.box!.bottom - $0.box!.top }.sorted()
            let box = group.dropFirst().reduce(group[0].box!) { $0.union($1.box!) }
            let icons = paragraphIcons(group)
            return Group(paragraphs: paragraphs(group), box: box, lineHeight: heights[heights.count / 2],
                         icons: icons.contains(where: { !$0.isEmpty }) ? icons : nil)
        }
    }

    /// Kalabalık ekranda en çok yazısı olan `maxGroups` grup, yukarıdan aşağı sırasıyla. Önceden en üstteki gruplar
    /// alınıyordu: menü ve gösterge etiketleri sınırı doldurunca ekranın alt yarısındaki bilgi kutusu hiç çevrilmiyordu.
    private static func busiest(_ groups: [[TextLine]]) -> [[TextLine]] {
        guard groups.count > maxGroups else { return groups }
        let letters = groups.map { group in group.reduce(0) { $0 + $1.text.filter(\.isLetter).count } }
        let kept = groups.indices.sorted { letters[$0] != letters[$1] ? letters[$0] > letters[$1] : $0 < $1 }.prefix(maxGroups)
        return kept.sorted().map { groups[$0] }
    }

    /// Alt satır, üstteki satırın bitmemiş cümlesini sürdürüyor: küçük harfle başlıyor, üstteki cümle sonu işaretiyle
    /// bitmiyor, yazı boyu benzer, yatayda üst üste ve arada satır yüksekliğinin bir buçuk katından az boşluk var.
    private static func continues(_ lower: TextLine, above upper: TextLine) -> Bool {
        guard let first = lower.text.first(where: \.isLetter), first.isLowercase,
              !SubtitleStabilizer.endsSentence(upper.text.trimmingCharacters(in: .whitespaces)),
              let below = lower.box, let above = upper.box else { return false }
        let a = above.bottom - above.top, b = below.bottom - below.top
        guard max(a, b) <= min(a, b) * 1.6 else { return false }
        guard below.top - above.bottom < max(a, b) * 1.5, below.top >= above.top else { return false }
        let overlap = min(below.right, above.right) - max(below.left, above.left)
        let narrower = min(below.right - below.left, above.right - above.left)
        return overlap > 0 && overlap >= narrower * 0.5
    }

    // Geniş başlık/alt satır iki bağımsız sütundan birine katılmasın. Filtrelenmiş OCR satırlarına bakılır.
    private static func bridgesColumns(_ wide: TextBox, _ column: TextBox, _ lines: [TextLine]) -> Bool {
        lines.contains { line in
            let peer = line.box!
            guard min(column.right, peer.right) <= max(column.left, peer.left) else { return false }
            let rowOverlap = min(column.bottom, peer.bottom) - max(column.top, peer.top)
            guard rowOverlap > 0, rowOverlap >= min(column.bottom - column.top, peer.bottom - peer.top) * 0.5 else { return false }
            return (belongs(column, below: wide) && belongs(peer, below: wide))
                || (belongs(wide, below: column) && belongs(wide, below: peer))
        }
    }

    /// Alt satır üsttekinin hemen altında (arada satır yüksekliğinin %80'inden az), yatayda onunla üst üste ve yazı boyu benzer.
    private static func belongs(_ lower: TextBox, below upper: TextBox) -> Bool {
        let a = upper.bottom - upper.top, b = lower.bottom - lower.top
        guard max(a, b) <= min(a, b) * 1.6 else { return false }
        guard lower.top - upper.bottom < max(a, b) * 0.8, lower.top >= upper.top else { return false }
        let overlap = min(lower.right, upper.right) - max(lower.left, upper.left)
        let narrower = min(lower.right - lower.left, upper.right - upper.left)
        return overlap > 0 && overlap >= narrower * 0.5
    }

    /// Önceki parça cümleyi bitirdiyse ya da kısa bir başlık/menü satırıysa (en çok üç sözcük, virgülsüz) ve yeni satır
    /// büyük harfle başlıyorsa yeni parça başlar; yoksa satır öncekinin devamıdır (cümle iki satıra sarılmış).
    static func paragraphs(_ lines: [TextLine]) -> [String] {
        var result: [String] = []
        for line in lines.map({ $0.text.trimmingCharacters(in: .whitespaces) }) {
            if let previous = result.last, !startsNew(after: previous, line) {
                result[result.count - 1] += " " + line
            } else {
                result.append(line)
            }
        }
        return result
    }

    /// `paragraphs` ile aynı bölmede her parçanın kumanda simgeleri, metindeki sırasıyla.
    static func paragraphIcons(_ lines: [TextLine]) -> [[IconSlot]] {
        var texts: [String] = []
        var result: [[IconSlot]] = []
        for line in lines {
            let text = line.text.trimmingCharacters(in: .whitespaces)
            let icons = line.icons ?? []
            if let previous = texts.last, !startsNew(after: previous, text) {
                texts[texts.count - 1] += " " + text
                result[result.count - 1] += icons
            } else {
                texts.append(text)
                result.append(icons)
            }
        }
        return result
    }

    private static func startsNew(after previous: String, _ line: String) -> Bool {
        if SubtitleStabilizer.endsSentence(previous) { return true }
        return line.first?.isUppercase == true && wordCount(previous) <= 3 && !previous.hasSuffix(",")
    }

    /// En az iki harfi ve iki harfli bir sözcüğü olan satır yazıdır; geri kalanı sayı ve simgedir.
    static func isWords(_ text: String) -> Bool {
        text.filter(\.isLetter).count >= 2 && text.split(whereSeparator: \.isWhitespace).contains { $0.filter(\.isLetter).count >= 2 }
    }

    private static func wordCount(_ text: String) -> Int { text.split(whereSeparator: \.isWhitespace).count }

    /// Çevirilerin TV'de kalma süresi (ms): yazı çoksa daha uzun; tuşa yeniden basınca hemen kalkar.
    public static func displayMilliseconds(_ items: [Item]) -> Int {
        min(60000, max(12000, 8000 + items.reduce(0) { $0 + $1.translation.count } * 50))
    }
}
