import Foundation
import Lndmobile

public struct LightningChannel: Sendable {
    public let point: String
    public let peer: String
    public let active: Bool
    public let localSats: UInt64
}

public struct WithdrawalReview: Sendable {
    public let token: String
    public let address: String
    public let sats: UInt64
    public let feeRate: UInt64
}

extension RegtestNode {
    public func listChannels() async throws -> [LightningChannel] {
        let response = try ProtoFields(await rpc { LndmobileListChannels(Data(), $0) })
        return try (response.bytes[11] ?? []).map {
            let channel = try ProtoFields($0)
            return LightningChannel(point: try channel.string(3), peer: try channel.string(2),
                                    active: channel.integers[1] == 1, localSats: channel.integers[6] ?? 0)
        }
    }

    // Tokens bind confirmation to immutable arguments and can be used only once.
    // Expiring a review never executes a transaction.
    public func reviewWithdrawal(address: String, sats: UInt64, feeRate: UInt64) async throws -> WithdrawalReview {
        try await requireSynced()
        guard address.hasPrefix(addressPrefix), address.count <= 90,
              address == address.lowercased(), address.utf8.allSatisfy({ (48...57).contains($0) || (97...122).contains($0) }),
              (546...1_000_000).contains(sats), (1...100).contains(feeRate) else { throw NodeFailure.invalidAmount }
        let review = WithdrawalReview(token: UUID().uuidString, address: address, sats: sats, feeRate: feeRate)
        withdrawalReviews = [review.token: (review, Date())]
        return review
    }

    public func withdraw(token: String) async throws -> String {
        guard !managementBusy, let (review, created) = withdrawalReviews.removeValue(forKey: token),
              Date().timeIntervalSince(created) < 120 else { throw NodeFailure.invalidReply }
        managementBusy = true
        defer { managementBusy = false }
        try await requireSynced()
        let request = ProtoFields.field(1, data: Data(review.address.utf8)) +
            ProtoFields.field(2, integer: review.sats) + ProtoFields.field(4, integer: review.feeRate) +
            ProtoFields.field(7, data: Data(("RedWallet withdrawal " + token).utf8)) + ProtoFields.field(8, integer: 1)
        let response = try ProtoFields(await rpc { LndmobileSendCoins(request, $0) })
        return try response.string(1)
    }

    public func closeChannel(point: String, feeRate: UInt64) async throws -> String {
        guard !managementBusy, !closingPoints.contains(point), (1...100).contains(feeRate) else { throw NodeFailure.invalidReply }
        managementBusy = true
        defer { managementBusy = false }
        try await requireSynced()
        let channels = try await listChannels()
        guard channels.contains(where: { $0.point == point }) else { throw NodeFailure.invalidReply }
        let parts = point.split(separator: ":")
        guard parts.count == 2, parts[0].count == 64, let index = UInt32(parts[1]),
              parts[0].utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw NodeFailure.invalidReply }
        closingPoints.insert(point)
        let channel = ProtoFields.field(2, data: Data(parts[0].utf8)) + ProtoFields.field(3, integer: UInt64(index))
        // Cooperative close only. Match the reviewed negotiation ceiling rather
        // than relying on LND's implicit three-times starting-fee default.
        // LND applies this ceiling when our node funded the channel.
        let request = ProtoFields.field(1, data: channel) + ProtoFields.field(6, integer: feeRate) +
            ProtoFields.field(7, integer: feeRate * 3)
        let response = try await rpc { LndmobileCloseChannel(request, CloseBroadcast($0)) }
        return String(decoding: response, as: UTF8.self)
    }

    public func onchainHistory() async throws -> String {
        let response = try ProtoFields(await rpc { LndmobileGetTransactions(Data(), $0) })
        let lines = try (response.bytes[1] ?? []).suffix(20).map {
            let tx = try ProtoFields($0)
            let amount = Int64(bitPattern: tx.integers[2] ?? 0)
            return "\(amount) \(units) · \(tx.integers[3] ?? 0) confirmations · " + (try tx.string(1))
        }
        return lines.isEmpty ? "No on-chain transactions." : lines.joined(separator: "\n")
    }
}

private final class CloseBroadcast: NSObject, LndmobileRecvStreamProtocol {
    private let reply: LndmobileCallbackProtocol
    init(_ reply: LndmobileCallbackProtocol) { self.reply = reply }
    func onError(_ error: Error?) { reply.onError(error ?? NodeFailure.invalidReply) }
    func onResponse(_ response: Data?) {
        do {
            let update = try ProtoFields(response ?? Data())
            guard let pending = update.bytes[1]?.first else { return }
            guard let txid = try ProtoFields(pending).bytes[1]?.first, txid.count == 32 else { throw NodeFailure.invalidReply }
            let value = txid.reversed().map { String(format: "%02x", $0) }.joined()
            reply.onResponse(Data(value.utf8))
        } catch { reply.onError(error) }
    }
}
