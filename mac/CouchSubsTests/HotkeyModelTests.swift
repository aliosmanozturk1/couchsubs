// SPDX-License-Identifier: AGPL-3.0-only

import CouchSubsCore
import RemotePlay
import XCTest
@testable import CouchSubs

/// Mac'in değiştirilebilir kısayolları ve bağlı işler (Windows: ShellWindow.ApplyHotkeys, AppController.ToggleSubtitles,
/// TranslateExtraRegionAsync ile aynı davranış).
@MainActor
final class HotkeyModelTests: XCTestCase {
    private let console = RegisteredConsole(host: "192.168.1.253", name: "PS5", registKey: Data(repeating: 0x31, count: 16), morning: Data(repeating: 2, count: 16))

    /// PS5 kurulu, altyazı bilgisayar ekranında (TV gerekmez).
    private func model() -> AppModel {
        let store = MemoryStore()
        store.save(Data(repeating: 1, count: 8), for: StoreKey.accountId)
        store.save(console, for: StoreKey.console)
        let model = AppModel(services: FakeServices(), store: store, defaults: .isolated())
        model.settings.output = .computer
        return model
    }

    private func drainMainQueue() async {
        let done = expectation(description: "ana kuyruk")
        DispatchQueue.main.async { done.fulfill() }
        await fulfillment(of: [done], timeout: 2)
    }

    /// Kısayollar yalnız çeviri sürerken tutulur; Ayarlar yeni tuş beklerken bırakılır (tuşlar diğer uygulamalarda serbest).
    func testHotkeysAreHeldOnlyWhileTranslating() async {
        let model = model()
        XCTAssertFalse(model.hotkeys.enabled)
        await model.start()
        XCTAssertTrue(model.hotkeys.enabled)
        model.hotkeysPaused = true
        XCTAssertFalse(model.hotkeys.enabled)
        model.hotkeysPaused = false
        XCTAssertTrue(model.hotkeys.enabled)
        model.stop()
        XCTAssertFalse(model.hotkeys.enabled)
    }

    /// Ayarlar'da değişen tuş hemen tutulan tabloya geçer; varsayılanlar Windows'taki işlerle aynı.
    func testChangedShortcutIsAppliedAndDefaultsMatchWindows() {
        let model = model()
        XCTAssertEqual(model.hotkeys.bindings, HotkeyTable.bindings)
        XCTAssertEqual(model.hotkeys.bindings.count, 2 * HotkeyAction.allCases.count)
        let key = HotkeyKey([.option, .command], 0x11)
        model.settings.hotkeys = HotkeyTable.assign([], .screen, slot: 0, key: key).choices
        XCTAssertEqual(model.hotkeys.bindings, HotkeyTable.resolve(model.settings.hotkeys))
        XCTAssertTrue(model.hotkeys.bindings.contains(HotkeyBinding(action: .screen, key: key)))
    }

    /// Num 0: canlı altyazı duraklar ve sürer; bilgisayar ekranında kısa bildirim çıkar. Çeviri sürmüyorsa bir şey olmaz.
    func testPauseSubtitlesTogglesWhileRunning() async {
        let model = model()
        model.toggleSubtitles()
        XCTAssertFalse(model.subtitlesPaused)
        await model.start()
        model.hotkeyPressed(.pauseSubtitles)
        XCTAssertTrue(model.subtitlesPaused)
        await drainMainQueue()
        XCTAssertEqual(model.overlayLines.last?.text, String(localized: "Subtitle translation paused"))
        model.hotkeyPressed(.pauseSubtitles)
        XCTAssertFalse(model.subtitlesPaused)
        // Oturum bitince duraklatma kalkar.
        model.hotkeyPressed(.pauseSubtitles)
        model.stop()
        XCTAssertFalse(model.subtitlesPaused)
    }

    /// Kısayolun alanı yoksa ya da çeviri sürmüyorsa tek seferlik okuma yapılmaz.
    func testAreaShortcutNeedsAnAreaAndARunningTranslation() async {
        let model = model()
        let outcome = await model.translateExtraArea(1)
        XCTAssertEqual(outcome, .notConfigured)
        model.settings.addExtraArea(.quest, name: "Görev")
        let stopped = await model.translateExtraArea(1)
        XCTAssertEqual(stopped, .notRunning)
        let third = await model.translateExtraArea(3)
        XCTAssertEqual(third, .notConfigured)
    }

    /// Serbest alanın ve ek alanların sonucunun yeri kaydedilir, yeniden açılışta kalır.
    func testResultTargetsArePersisted() {
        let defaults = UserDefaults.isolated()
        let model = AppModel(services: FakeServices(), store: MemoryStore(), defaults: defaults)
        model.settings.freeAreaTarget = .pc
        let id = model.settings.addExtraArea(.phone, name: "Telefon")!
        model.settings.updateExtraArea(id: id) { $0.target = .both; $0.enabled = false }
        let reopened = AppModel(services: FakeServices(), store: MemoryStore(), defaults: defaults)
        XCTAssertEqual(reopened.settings.freeAreaTarget, .pc)
        XCTAssertEqual(reopened.settings.extraAreas.first?.target, .both)
        XCTAssertEqual(reopened.settings.extraAreas.first?.enabled, false)
    }
}
