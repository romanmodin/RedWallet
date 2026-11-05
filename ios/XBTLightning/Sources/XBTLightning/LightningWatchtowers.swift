import Foundation
import Lndmobile

public struct LightningTower {
    public let key: String
    public let addresses: [String]
    public let eligible: Bool
    public let sessions: UInt64
    public let acknowledged: UInt64
    public let pending: UInt64

    static func decode(_ response: Data) throws -> [LightningTower] {
        try (ProtoFields(response).bytes[1] ?? []).map { data in
            let tower = try ProtoFields(data)
            guard let key = tower.bytes[1]?.first, key.count == 33,
                  key.first == 2 || key.first == 3 else { throw NodeFailure.invalidReply }
            let groups = try (tower.bytes[6] ?? []).map(ProtoFields.init)
            // Modern session_info replaces the deprecated fields; never sum both.
            let sessionData = groups.isEmpty ? tower.bytes[5] ?? [] : groups.flatMap { $0.bytes[3] ?? [] }
            let sessions = try sessionData.map(ProtoFields.init)
            return LightningTower(
                key: key.map { String(format: "%02x", $0) }.joined(),
                addresses: (tower.bytes[2] ?? []).map { String(decoding: $0, as: UTF8.self) },
                eligible: groups.isEmpty ? tower.integers[3] == 1 : groups.contains { $0.integers[1] == 1 },
                sessions: groups.isEmpty ? tower.integers[4] ?? 0 : groups.reduce(0) { $0 + ($1.integers[2] ?? 0) },
                acknowledged: sessions.reduce(0) { $0 + ($1.integers[1] ?? 0) },
                pending: sessions.reduce(0) { $0 + ($1.integers[2] ?? 0) })
        }
    }
}

public enum LightningWatchtower {
    // Published by Kilombino/kilowallet, Lightning.kt at d1fd03b (Apache-2.0).
    // A selectable preset; no claim of operator endorsement or service availability.
    public static let defaultURI = "033f366c8e43b040dbc27648d68e123650ec1f23176de092f39b9e0a7fb4f2a95d@b44c2u3dar4fdhb4m4vsp3v6kzohh2cqrggk2io74v4olr4nn5nytyad.onion:9911"

    static func publicKey(_ text: String) throws -> Data {
        guard text.utf8.count == 66, text.hasPrefix("02") || text.hasPrefix("03"),
              text.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw NodeFailure.invalidPeer }
        let chars = Array(text)
        return Data(stride(from: 0, to: 66, by: 2).map { UInt8(String(chars[$0...$0+1]), radix: 16)! })
    }
    static func parse(_ uri: String, usingTor: Bool) throws -> (Data, String) {
        let parts = uri.trimmingCharacters(in: .whitespacesAndNewlines).split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2 else { throw NodeFailure.invalidPeer }
        return (try publicKey(String(parts[0]).lowercased()), try MainnetConfiguration.endpoint(String(parts[1]), usingTor: usingTor))
    }
}

extension RegtestNode {
    public func watchtowers() async throws -> [LightningTower] {
        // include_sessions=true, including exhausted sessions: their acknowledgments still matter.
        try LightningTower.decode(await rpc { LndmobileWatchtowerClientListTowers(ProtoFields.field(1, integer: 1), $0) })
    }
    public func addWatchtower(_ uri: String) async throws {
        guard try await status() == "Running" else { throw NodeFailure.notSynced }
        let (key, address) = try LightningWatchtower.parse(uri, usingTor: activeTransport == .tor)
        if activeTransport == .tor { _ = try await LightningTor.shared.start() }
        let request = ProtoFields.field(1, data: key) + ProtoFields.field(2, data: Data(address.utf8))
        _ = try await rpc { LndmobileWatchtowerClientAddTower(request, $0) }
    }
    public func removeWatchtower(_ key: String) async throws {
        let request = try ProtoFields.field(1, data: LightningWatchtower.publicKey(key))
        _ = try await rpc { LndmobileWatchtowerClientRemoveTower(request, $0) }
    }
}
