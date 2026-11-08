import Foundation
import Lndmobile

extension RegtestNode {
    public func details() async throws -> String {
        let info = try ProtoFields(await XBTLightningNode.info())
        let balance = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) })
        let channels = try ProtoFields(await rpc { LndmobileChannelBalance(Data(), $0) })
        let local = try ProtoFields(channels.bytes[3]?.first ?? Data())
        let remote = try ProtoFields(channels.bytes[4]?.first ?? Data())
        let publicKey = try info.string(1)
        let height = info.integers[6] ?? 0
        let synced = info.integers[9] == 1 ? "yes" : "no"
        let onChain = balance.integers[2] ?? 0
        let outbound = local.integers[1] ?? 0, inbound = remote.integers[1] ?? 0
        let count = info.integers[4] ?? 0
        return """
        Node: \(publicKey)
        Chain height: \(height)
        Synced: \(synced)
        Confirmed funding balance: \(onChain) \(units)
        Local / remote channel balance: \(outbound) / \(inbound) \(units)
        Active channels: \(count)
        """
    }

    public func fundingAddress() async throws -> String {
        // UNUSED_TAPROOT_PUBKEY keeps the receiving address until LND observes a deposit.
        let fields = try ProtoFields(await rpc { LndmobileNewAddress(ProtoFields.field(1, integer: 5), $0) })
        let address = try fields.string(1)
        guard address.hasPrefix(addressPrefix) else { throw NodeFailure.invalidReply }
        return address
    }

    public func connect(to uri: String) async throws {
        let parts = uri.split(separator: "@", omittingEmptySubsequences: false)
        guard parts.count == 2 else { throw NodeFailure.invalidPeer }
        let key = String(parts[0])
        let endpoint = parts[1].split(separator: ":", omittingEmptySubsequences: false)
        guard validKey(key), endpoint.count == 2, let port = UInt16(endpoint[1]), port > 0 else { throw NodeFailure.invalidPeer }
        let host: String
        if mainnet { host = try MainnetConfiguration.endpoint(String(parts[1]), usingTor: activeTransport == .tor) }
        else { host = try Self.privatePeer(String(endpoint[0])) + ":" + String(port) }
        let remote = ProtoFields.field(1, data: Data(key.utf8)) + ProtoFields.field(2, data: Data(host.utf8))
        if mainnet && activeTransport == .tor { _ = try await LightningTor.shared.start() }
        let connectionTimeout: UInt64 = activeTransport == .tor ? 45 : 15
        let request = ProtoFields.field(1, data: remote) + ProtoFields.field(3, integer: connectionTimeout)
        _ = try await rpc { LndmobileConnectPeer(request, $0) }
    }

    private func validKey(_ key: String) -> Bool {
        key.utf8.count == 66 && (key.hasPrefix("02") || key.hasPrefix("03")) &&
            key.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }

    public func openChannel(to key: String, sats: UInt64, feeRate: UInt64 = 1) async throws -> String {
        guard sats <= LightningAmounts.maxChannelOpenSats else { throw NodeFailure.channelOpeningLimit }
        try await requireSynced()
        guard validKey(key), LightningAmounts.valid(sats), LightningAmounts.validFeeRate(feeRate) else { throw NodeFailure.invalidAmount }
        let request = ProtoFields.field(3, data: Data(key.utf8)) + ProtoFields.field(4, integer: sats) +
            ProtoFields.field(1, integer: feeRate) + ProtoFields.field(8, integer: 1)
        let point = try ProtoFields(await rpc { LndmobileOpenChannelSync(request, $0) })
        let txid: String
        if let bytes = point.bytes[1]?.first, bytes.count == 32 {
            txid = bytes.reversed().map { String(format: "%02x", $0) }.joined()
        } else {
            txid = try point.string(2)
        }
        return txid + ":" + String(point.integers[3] ?? 0)
    }
}
