// SPDX-License-Identifier: AGPL-3.0-only

import XCTest
@testable import CouchSubs

/// iPhone + Android TV: TV uygulaması telefonun adresiyle açılır (TestFlight 20 Kas, GitHub #672). Eskiden telefon Android
/// TV'ye hiç dokunmuyor, TV uygulaması telefonu ağ taramasıyla bulamazsa "Ağda CouchSubs aranıyor…"da kalıyordu.
final class AndroidTVKeeperTests: XCTestCase {
    func testStartCommandCarriesTheServerAddress() {
        let params = AndroidTvInstaller.launchParams(server: "http://192.168.1.124:8787")
        XCTAssertEqual(params, #"{"server":"http://192.168.1.124:8787"}"#)
        XCTAssertEqual(AndroidTvInstaller.startCommand(params),
                       #"shell:am start -n com.couchsubs.tv/.MainActivity --es params '{"server":"http://192.168.1.124:8787"}'"#)
    }

    /// TV'de sh çalıştırır: tek tırnak ya da satır sonu içeren değer hiç gönderilmez (Windows'taki StartCommand ile aynı).
    func testStartCommandDropsUnsafeParams() {
        let plain = "shell:am start -n com.couchsubs.tv/.MainActivity"
        XCTAssertEqual(AndroidTvInstaller.startCommand(nil), plain)
        XCTAssertEqual(AndroidTvInstaller.startCommand(""), plain)
        XCTAssertEqual(AndroidTvInstaller.startCommand(#"{"server":"x'; reboot; '"}"#), plain)
        XCTAssertEqual(AndroidTvInstaller.startCommand("{\"a\":\"b\"}\nreboot"), plain)
    }

    private final class Calls: @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String] = []
        func add(_ value: String) { lock.lock(); values.append(value); lock.unlock() }
        var all: [String] { lock.lock(); defer { lock.unlock() }; return values }
    }

    func testOpensTheAppOnlyWhileItIsNotConnectedAndNotTooOften() {
        let opened = Calls(), logged = Calls()
        let connected = Calls()
        let keeper = AndroidTVKeeper(host: "192.168.1.120", port: 5555, server: "http://192.168.1.124:8787",
                                     appConnected: { connected.all.last == "1" }, relaunchInterval: 30,
                                     open: { host, port, params in opened.add("\(host):\(port) \(params ?? "-")"); return "Starting" },
                                     log: { logged.add($0) })
        let start = Date()
        keeper.tick(now: start)
        keeper.tick(now: start.addingTimeInterval(5))
        XCTAssertEqual(opened.all, [#"192.168.1.120:5555 {"server":"http://192.168.1.124:8787"}"#])
        keeper.tick(now: start.addingTimeInterval(31))
        XCTAssertEqual(opened.all.count, 2)
        // Aynı sonuç günlüğe bir kez yazılır.
        XCTAssertEqual(logged.all.count, 1)
        connected.add("1")
        keeper.tick(now: start.addingTimeInterval(120))
        XCTAssertEqual(opened.all.count, 2)
        // Uygulama öne gelince beklemeden yeniden denenir.
        connected.add("0")
        keeper.tick(now: start.addingTimeInterval(121))
        XCTAssertEqual(opened.all.count, 3)
        keeper.reconnect()
        keeper.tick(now: start.addingTimeInterval(122))
        XCTAssertEqual(opened.all.count, 4)
    }

    func testClosedAdbIsSilentAndLoggedOnce() {
        let logged = Calls()
        let keeper = AndroidTVKeeper(host: "192.168.1.120", port: 5555, server: "http://192.168.1.124:8787", appConnected: { false },
                                     relaunchInterval: 0,
                                     open: { _, _, _ in throw AndroidInstallFailure(error: .unreachable, detail: "kapalı") },
                                     log: { logged.add($0) })
        keeper.tick()
        keeper.tick()
        XCTAssertEqual(logged.all.count, 1)
        XCTAssertTrue(logged.all[0].contains("açılamadı"))
    }

    func testSavedWirelessPortIsUsedForTheSameTV() throws {
        let defaults = try XCTUnwrap(UserDefaults(suiteName: "android-tv-keeper-tests"))
        defaults.removePersistentDomain(forName: "android-tv-keeper-tests")
        XCTAssertEqual(InstalledTVApp.adbPort(for: "192.168.1.120", defaults: defaults), 5555)
        let saved = InstalledTVApp(brand: .androidTV, host: "192.168.1.120", port: 41235, version: "0.9.43")
        defaults.set(try JSONEncoder().encode(saved), forKey: "tvAppInstalled")
        XCTAssertEqual(InstalledTVApp.adbPort(for: "192.168.1.120", defaults: defaults), 41235)
        XCTAssertEqual(InstalledTVApp.adbPort(for: "192.168.1.99", defaults: defaults), 5555)
    }
}
