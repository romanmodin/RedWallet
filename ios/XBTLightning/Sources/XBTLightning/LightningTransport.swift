import Foundation

public enum LightningTransport: String, Codable {
    case direct, tor
}

struct LightningNetworkStore {
    static func load(at file: URL) throws -> LightningTransport {
        guard FileManager.default.fileExists(atPath: file.path) else { return .direct }
        return try JSONDecoder().decode(LightningTransport.self, from: Data(contentsOf: file))
    }
    static func save(_ mode: LightningTransport, at file: URL) throws {
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(mode).write(to: file, options: .atomic)
    }
}

enum TransportFailure: LocalizedError {
    case torUnavailable, requiresTor, restartRequired, requiresNewerSystem
    var errorDescription: String? {
        switch self {
        case .torUnavailable: return "Tor could not connect. No direct connection was used. Try again when your network is available."
        case .requiresTor: return "This onion address requires Tor. Select Tor for Lightning and restart RedWallet if the node is already running."
        case .restartRequired: return "Close and reopen RedWallet to apply the saved Lightning connection setting. Your wallet and channels are retained."
        case .requiresNewerSystem: return "Lightning over Tor requires iOS 17 or later."
        }
    }
}
