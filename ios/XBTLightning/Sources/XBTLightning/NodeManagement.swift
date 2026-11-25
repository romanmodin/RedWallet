import Foundation
import Lndmobile

public struct LightningChannel: Sendable {
    public let point: String
    public let peer: String
    public let active: Bool
    public let localSats: UInt64
}

// A read-only snapshot includes channels that ListChannels deliberately omits.
public struct LightningChannelStatus: Sendable {
    public let point: String
    public let peer: String
    public let state: String
    public let localSats: UInt64
    public let remoteSats: UInt64?
    public let confirmationsRemaining: UInt64?
    public var splice: SpliceChannelState?
    public var sendLimits: [String: String]? = nil
    public var receiveLimits: [String: String]? = nil
    public var peerAlias: String? = nil
    public var peerAddress: String? = nil
    public var originalPoint: String? = nil
    var fundingSnapshot: FundingSnapshot? = nil
    public var peerFunding: PeerFundingHistory? = nil

    private static func paymentLimits(_ data: Data?) -> [String: String]? {
        guard let data, let constraints = try? ProtoFields(data) else { return nil }
        var limits: [String: String] = [:]
        if let max = constraints.integers[4] { limits["maxPendingMsat"] = String(max) }
        // Proto3 omits the scalar when the minimum is zero.
        limits["minPartMsat"] = String(constraints.integers[5] ?? 0)
        return limits
    }

    static func decode(open: Data, pending: Data, awaitingSplices: Set<String> = [], peers: Data? = nil) throws -> [LightningChannelStatus] {
        var items: [String: LightningChannelStatus] = [:]
        for bytes in try ProtoFields(open).bytes[11] ?? [] {
            let channel = try ProtoFields(bytes)
            let point = try channel.string(3)
            items[point] = LightningChannelStatus(
                point: point, peer: try channel.string(2),
                state: channel.integers[1] == 1 ? "active" : "inactive",
                localSats: channel.integers[6] ?? 0, remoteSats: channel.integers[7] ?? 0,
                confirmationsRemaining: nil, splice: try SpliceChannelState.decode(channel, awaitingNewAttempt: awaitingSplices.contains(point)))
            items[point]?.sendLimits = paymentLimits(channel.bytes[29]?.first)
            items[point]?.receiveLimits = paymentLimits(channel.bytes[30]?.first)
            items[point]?.peerAlias = try? channel.string(34)
            items[point]?.originalPoint = try? channel.string(1005)
            items[point]?.fundingSnapshot = FundingSnapshot(channel, point: point)
        }
        let response = try ProtoFields(pending)
        let states: [(UInt64, String)] = [(2, "pending"), (3, "closing"), (5, "closing"), (4, "forceClosing")]
        for (field, state) in states {
            for bytes in response.bytes[field] ?? [] {
                let wrapper = try ProtoFields(bytes)
                guard let raw = wrapper.bytes[1]?.first else { throw NodeFailure.invalidReply }
                let channel = try ProtoFields(raw)
                let point = try channel.string(2)
                // RPC snapshots can straddle a state transition. Count each
                // funding outpoint once; open supersedes pending, closing wins.
                if state == "pending", items[point] != nil { continue }
                items[point] = LightningChannelStatus(
                    point: point, peer: try channel.string(1), state: state,
                    localSats: channel.integers[4] ?? 0,
                    // Pending-open and waiting-close report both balances, including zero.
                    // A historical close summary can omit the peer's balance entirely.
                    remoteSats: (field == 2 || field == 5) ? (channel.integers[5] ?? 0) : channel.integers[5],
                    confirmationsRemaining: state == "pending" ? wrapper.integers[7] : nil, splice: nil)
            }
        }
        // Peer metadata is optional: losing ListPeers must not hide channels.
        if let peers, let response = try? ProtoFields(peers) {
            for bytes in response.bytes[1] ?? [] {
                guard let peer = try? ProtoFields(bytes), let key = try? peer.string(1),
                      let address = try? peer.string(3) else { continue }
                for point in Array(items.keys) where items[point]?.peer == key {
                    items[point]?.peerAddress = address
                }
            }
        }
        return items.values.sorted { $0.point < $1.point }
    }
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

    public func channelStatus() async throws -> [LightningChannelStatus] {
        let pending = try await rpc { LndmobilePendingChannels(Data(), $0) }
        let open = try await rpc { LndmobileListChannels(ProtoFields.field(6, integer: 1), $0) }
        let peers = try? await rpc { LndmobileListPeers(Data(), $0) }
        var items = try LightningChannelStatus.decode(open: open, pending: pending, awaitingSplices: splicingPoints, peers: peers)
        let needsTransactions = items.contains { channel in
            if let funding = channel.fundingSnapshot, funding.original != funding.point { return true }
            return !(channel.splice?.txid ?? "").isEmpty
        }
        let transactions = needsTransactions ? try? await rpc({ LndmobileGetTransactions(Data(), $0) }) : nil
        let walletSynced = transactions != nil ? (try? await requireSynced()) != nil : false
        let history = FundingTransactions(transactions, walletSynced: walletSynced)
        for index in items.indices {
            if let txid = items[index].splice?.txid {
                items[index].splice?.onchainConfirmations = history.confirmations[txid]
            }
        }
        let file = try? FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                                appropriateFor: nil, create: false)
            .appendingPathComponent(directoryName).appendingPathComponent("channel-funding-v1.json")
        // Don't replace a file that's inaccessible while locked or can't be decoded.
        var stored: [String: FundingJournal]? = nil
        if let file {
            do { stored = try JSONDecoder().decode([String: FundingJournal].self, from: Data(contentsOf: file)) }
            catch let error as CocoaError where error.code == .fileReadNoSuchFile { stored = [:] }
            catch {}
        }
        var journals = stored ?? [:]
        for index in items.indices {
            guard let snapshot = items[index].fundingSnapshot else { continue }
            items[index].peerFunding = journals[snapshot.original, default: FundingJournal()].update(snapshot, transactions: history)
        }
        if let file, let stored, stored != journals {
            try? JSONEncoder().encode(journals).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        return items
    }

    // Tokens bind confirmation to immutable arguments and can be used only once.
    // Expiring a review never executes a transaction.
    public func reviewWithdrawal(address: String, sats: UInt64, feeRate: UInt64) async throws -> WithdrawalReview {
        guard address.hasPrefix(addressPrefix), address.count <= 90,
              address == address.lowercased(), address.utf8.allSatisfy({ (48...57).contains($0) || (97...122).contains($0) }),
              LightningAmounts.valid(sats), LightningAmounts.validFeeRate(feeRate) else { throw NodeFailure.invalidAmount }
        try await requireSynced()
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
        guard !managementBusy, !closingPoints.contains(point), !splicingPoints.contains(point), LightningAmounts.validFeeRate(feeRate) else { throw NodeFailure.invalidReply }
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
