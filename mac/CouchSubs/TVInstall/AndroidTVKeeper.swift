// SPDX-License-Identifier: AGPL-3.0-only

import CouchSubsCore
import Foundation

/// Android TV'de CouchSubs TV'yi Mac'in adresiyle açar ve bağlı değilken en çok `relaunchInterval`'da bir yeniden açar
/// (ADB açıksa; gömülü yardımcının `android-open` komutu). iPhone'daki AndroidTVKeeper, Windows'taki AndroidTvKeeper ve
/// Android telefondaki keepAndroidTvOpen ile aynı kural.
///
/// Eskiden Mac Android TV'ye hiç dokunmuyordu: çeviri başlayınca TV uygulaması kendiliğinden açılmıyor, kullanıcı TV'den
/// açması gerektiğini bilmiyordu. ADB kapalıysa ya da TV bu Mac'i onaylamadıysa sessizce geçilir (onay sorusu beklenmez);
/// nedeni ana ekranda söylenir. Yalnız sunucu adresi gider, TV yine ekrandaki kodun onayıyla (/pair) eşleşir.
final class AndroidTVKeeper: KeeperControlling, @unchecked Sendable {
    private let host: String
    private let launchParams: String?
    private let appConnected: @Sendable () -> Bool
    private let relaunchInterval: Duration
    private let open: @Sendable (String, String?) async throws -> String
    private let onOpenResult: @Sendable (TVOpenProblem?) -> Void
    private let lock = NSLock()
    private var loop: Task<Void, Never>?
    private var lastLaunch: ContinuousClock.Instant?
    private var lastResult: String?

    init(host: String, server: String, appConnected: @escaping @Sendable () -> Bool, relaunchInterval: Duration = .seconds(30),
         open: @escaping @Sendable (String, String?) async throws -> String = AndroidTVKeeper.openWithHelper,
         onOpenResult: @escaping @Sendable (TVOpenProblem?) -> Void = { _ in }) {
        self.host = host
        launchParams = Self.launchParams(server: server)
        self.appConnected = appConnected
        self.relaunchInterval = relaunchInterval
        self.open = open
        self.onOpenResult = onOpenResult
    }

    /// Yalnız sunucu adresi gider; erişim anahtarı gitmez (Android TV kullanıcı onaylı eşleştirmeyle bağlanır).
    static func launchParams(server: String) -> String? {
        guard let data = try? JSONSerialization.data(withJSONObject: ["server": server], options: [.withoutEscapingSlashes]) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    /// Kurulu uygulamayı gömülü yardımcıyla açar; TV onay sorarsa beklenmez (NotApproved), ADB kapalıysa Unreachable.
    static let openWithHelper: @Sendable (String, String?) async throws -> String = { host, params in
        let result = try await TVHelper.run(["android-open", "--host", host,
                                             "--key-dir", TVHelper.dataDirectory.appendingPathComponent("adb").path]
                                            + (params.map { ["--params", $0] } ?? []))
        return result.version ?? ""
    }

    /// Açılamamanın nedeni: TV hata ayıklama iznini onaylamadıysa ayrı, gerisi "ulaşılamıyor".
    static func problem(_ error: Error) -> TVOpenProblem {
        (error as? DevModeFailure)?.error == .notApproved ? .debugNotApproved : .debugOff
    }

    /// Bir kontrol: TV uygulaması bağlı değilse ve son açılıştan `relaunchInterval` geçtiyse açar.
    func tick(now: ContinuousClock.Instant = .now) async {
        guard !host.isEmpty, !appConnected() else { return }
        let due: Bool = lock.withLock {
            if let lastLaunch, now - lastLaunch < relaunchInterval { return false }
            lastLaunch = now
            return true
        }
        guard due else { return }
        let result: String
        do {
            result = "açıldı: \(try await open(host, launchParams))"
            onOpenResult(nil)
        } catch {
            result = "açılamadı: \(error)"
            onOpenResult(Self.problem(error))
        }
        // Aynı sonuç her denemede yeniden yazılmaz.
        let changed: Bool = lock.withLock {
            defer { lastResult = result }
            return lastResult != result
        }
        if changed { TVInstallLog.write("Android TV (\(host)) Mac'in adresiyle \(result)") }
    }

    func start(interval: Duration) {
        stop()
        loop = Task.detached(priority: .utility) { [weak self] in
            while !Task.isCancelled {
                await self?.tick()
                try? await Task.sleep(for: interval)
            }
        }
    }

    func stop() {
        loop?.cancel()
        loop = nil
    }

    /// Uykudan dönüşte ya da "Otomatik açmayı dene"de: bir sonraki kontrol beklemeden açar.
    func reconnect() {
        lock.withLock { lastLaunch = nil }
    }

    deinit { loop?.cancel() }
}
