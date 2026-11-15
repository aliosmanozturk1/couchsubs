// SPDX-License-Identifier: AGPL-3.0-only
// Ev yayını oturumunun durum makinesi ve veri kanalı iletileri (Android: XboxSessionMachine.kt, XboxChannels.kt).
// Kurallar Windows'taki XboxStreamSession ile aynı; iletiler xbox-xcloud-player 0.2.11'inkilerle birebir (MIT, unknownskl).

import Foundation

struct XboxSessionMachine {
    enum Phase: Equatable {
        case idle, starting
        case provisioning(polls: Int, connectSent: Bool)
        case negotiating, streaming
        case failed(XboxErrorKind, message: String, willRetry: Bool)
        case stopped
    }

    enum Action: Equatable {
        case play
        case pollState(delayMs: Int)
        case connect
        case negotiate
        /// Oturumu kapat; `delayMs` sonra baştan başla (nil: durul).
        case retry(delayMs: Int?)
        case nothing
    }

    static let fatal: Set<XboxErrorKind> = [.signInRequired, .noXboxAccount]

    let maxPolls: Int
    let pollIntervalMs: Int
    let retryDelayMs: Int
    private(set) var phase: Phase = .idle

    init(maxPolls: Int = 90, pollIntervalMs: Int = 1000, retryDelayMs: Int = 5000) {
        self.maxPolls = maxPolls
        self.pollIntervalMs = pollIntervalMs
        self.retryDelayMs = retryDelayMs
    }

    mutating func start() -> Action {
        guard phase != .stopped else { return .nothing }
        phase = .starting
        return .play
    }

    mutating func played() -> Action {
        guard phase == .starting else { return .nothing }
        phase = .provisioning(polls: 0, connectSent: false)
        return .pollState(delayMs: 0)
    }

    mutating func status(_ state: String, errorDetails: String?) -> Action {
        guard case let .provisioning(polls, connectSent) = phase else { return .nothing }
        switch state {
        case "Provisioned":
            phase = .negotiating
            return .negotiate
        case "Failed":
            return fail(Self.classifyFailure(errorDetails), errorDetails ?? "Xbox yayını açılamadı")
        case "ReadyToConnect" where !connectSent:
            phase = .provisioning(polls: polls, connectSent: true)
            return .connect
        default:
            return poll(polls: polls, connectSent: connectSent)
        }
    }

    mutating func connected() -> Action {
        guard case let .provisioning(polls, connectSent) = phase else { return .nothing }
        return poll(polls: polls, connectSent: connectSent)
    }

    private mutating func poll(polls: Int, connectSent: Bool) -> Action {
        let next = polls + 1
        if next >= maxPolls { return fail(.timeout, "Xbox yayını hazır olmayı beklerken zaman aşımına uğradı") }
        phase = .provisioning(polls: next, connectSent: connectSent)
        return .pollState(delayMs: pollIntervalMs)
    }

    mutating func streaming() -> Bool {
        guard phase == .negotiating else { return false }
        phase = .streaming
        return true
    }

    mutating func fail(_ kind: XboxErrorKind, _ message: String) -> Action {
        guard phase != .stopped else { return .nothing }
        let retry = !Self.fatal.contains(kind)
        phase = .failed(kind, message: message, willRetry: retry)
        return .retry(delayMs: retry ? retryDelayMs : nil)
    }

    mutating func stop() { phase = .stopped }

    static func classifyFailure(_ details: String?) -> XboxErrorKind {
        let text = (details ?? "").lowercased()
        if ["inuse", "busy", "alreadystreaming"].contains(where: text.contains) { return .busy }
        return .consoleUnavailable
    }
}

enum XboxChannels {
    /// Kanal adı → protokol; oluşturma sırası oynatıcıdaki gibi.
    static let channels: [(name: String, protocol: String)] = [("input", "1.0"), ("chat", "chatV1"), ("control", "controlV1"), ("message", "messageV1")]
    static let handshake = "{\"type\":\"Handshake\",\"version\":\"messageV1\",\"id\":\"f9c5f412-0e69-4ede-8e62-92c7f5358c56\",\"cv\":\"\"}"
    static let authorization = "{\"message\":\"authorizationRequest\",\"accessKey\":\"4BDB3609-C1F1-4195-9B37-FEFF45DA8B8E\"}"
    static let gamepadAdded = "{\"message\":\"gamepadChanged\",\"gamepadIndex\":0,\"wasAdded\":true}"
    private static let messageId = "41f93d5a-900f-4d33-b7a1-2d4ca6747072"

    static func isHandshakeAck(_ text: String) -> Bool { (try? parseJSON(text))?["type"] as? String == "HandshakeAck" }

    static func configurationMessages(width: Int = 1920, height: Int = 1080) -> [String] {
        func message(_ target: String, _ data: JSON) -> String {
            jsonText(["type": "Message", "content": jsonText(data), "id": messageId, "target": target, "cv": ""])
        }
        return [
            message("/streaming/systemUi/configuration", ["version": [0, 1, 0], "systemUis": [Int]()]),
            message("/streaming/properties/clientappinstallidchanged", ["clientAppInstallId": "c11ddb2e-c7e3-4f02-a62b-fd5448e0b851"]),
            message("/streaming/characteristics/orientationchanged", ["orientation": 0]),
            message("/streaming/characteristics/touchinputenabledchanged", ["touchInputEnabled": false]),
            message("/streaming/characteristics/clientdevicecapabilities", [:]),
            message("/streaming/characteristics/dimensionschanged", [
                "horizontal": width, "vertical": height, "preferredWidth": width, "preferredHeight": height,
                "safeAreaLeft": 0, "safeAreaTop": 0, "safeAreaRight": width, "safeAreaBottom": height, "supportsCustomResolution": true]),
        ]
    }

    /// `input` kanalının ilk paketi (ClientMetadata, 15 bayt, küçük sonlu).
    static func clientMetadataPacket(sequence: UInt32 = 0, timestampMs: Double, maxTouchpoints: UInt8 = 2) -> Data {
        var data = Data()
        withUnsafeBytes(of: UInt16(8).littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: sequence.littleEndian) { data.append(contentsOf: $0) }
        withUnsafeBytes(of: timestampMs.bitPattern.littleEndian) { data.append(contentsOf: $0) }
        data.append(maxTouchpoints)
        return data
    }

    /// Oynatıcının SDP düzeltmesi: stereo ses (ilk `useinbandfec=1`).
    static func mungeOffer(_ sdp: String) -> String {
        guard let range = sdp.range(of: "useinbandfec=1") else { return sdp }
        return sdp.replacingCharacters(in: range, with: "useinbandfec=1; stereo=1")
    }
}
