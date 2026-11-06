import Foundation
import Lndmobile

// Read-only records. Never export preimages, payment secrets or HTLC routes to the wallet list.
public struct LightningWalletActivity: Sendable {
    public let id: String
    public let direction: String
    public let sats: String
    public let feeSats: String
    public let timestamp: UInt64
    public let state: String
    public let memo: String
    public let confirmations: Int64?

    public var dictionary: [String: Any] {
        var result: [String: Any] = ["id": id, "direction": direction, "sats": sats, "feeSats": feeSats,
                                   "timestamp": timestamp, "state": state, "memo": memo]
        if let confirmations { result["confirmations"] = confirmations }
        return result
    }

    static func payments(_ data: Data) throws -> [Self] {
        try (ProtoFields(data).bytes[1] ?? []).map {
            let row = try ProtoFields($0)
            let status = row.integers[10] ?? 0
            return Self(id: try row.string(1), direction: "sent", sats: String(row.integers[7] ?? 0),
                        feeSats: String(row.integers[11] ?? 0),
                        timestamp: (row.integers[13].map { $0 / 1_000_000_000 }) ?? row.integers[3] ?? 0,
                        state: [1: "pending", 2: "settled", 3: "failed", 4: "pending"][status] ?? "unknown",
                        memo: "", confirmations: nil)
        }
    }

    static func invoices(_ data: Data, now: UInt64) throws -> [Self] {
        try (ProtoFields(data).bytes[1] ?? []).map {
            let row = try ProtoFields($0)
            guard let hash = row.bytes[4]?.first, hash.count == 32 else { throw NodeFailure.invalidReply }
            let status = row.integers[21] ?? 0
            let created = row.integers[7] ?? 0
            let expiry = row.integers[11] ?? 86400
            let expired = now >= created && now - created >= expiry
            let state = status == 1 ? "settled" : status == 2 ? "canceled" : status == 3 ? "pending" : expired ? "expired" : "unpaid"
            return Self(id: hash.map { String(format: "%02x", $0) }.joined(), direction: "received",
                        sats: String(row.integers[status == 1 || status == 3 ? 19 : 5] ?? 0), feeSats: "0",
                        timestamp: status == 1 ? row.integers[8] ?? created : created,
                        state: state, memo: String(decoding: row.bytes[1]?.first ?? Data(), as: UTF8.self), confirmations: nil)
        }
    }

    static func funding(_ data: Data) throws -> [Self] {
        try (ProtoFields(data).bytes[1] ?? []).map {
            let row = try ProtoFields($0)
            let amount = Int64(bitPattern: row.integers[2] ?? 0)
            let confirmations = Int64(bitPattern: row.integers[3] ?? 0)
            return Self(id: try row.string(1), direction: amount < 0 ? "sent" : "received", sats: String(amount.magnitude),
                        feeSats: String(row.integers[7] ?? 0), timestamp: row.integers[6] ?? 0,
                        state: confirmations < 0 ? "conflicted" : confirmations == 0 ? "pending" : "confirmed",
                        memo: String(decoding: row.bytes[10]?.first ?? Data(), as: UTF8.self), confirmations: confirmations)
        }
    }
}

extension RegtestNode {
    public func walletOverview() async throws -> [String: Any] {
        let info = try ProtoFields(await XBTLightningNode.info())
        let wallet = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) })
        let channels = try ProtoFields(await rpc { LndmobileChannelBalance(Data(), $0) })
        func amount(_ field: UInt64) throws -> String {
            String(try ProtoFields(channels.bytes[field]?.first ?? Data()).integers[1] ?? 0)
        }
        return ["node": try info.string(1), "synced": info.integers[9] == 1,
                "peers": String(info.integers[5] ?? 0), "height": String(info.integers[6] ?? 0), "activeChannels": String(info.integers[4] ?? 0),
                "fundingTotal": String(wallet.integers[1] ?? 0), "fundingConfirmed": String(wallet.integers[2] ?? 0),
                "fundingPending": String(wallet.integers[3] ?? 0), "fundingLocked": String(wallet.integers[5] ?? 0),
                "anchorReserve": String(wallet.integers[6] ?? 0), "lightningLocal": try amount(3),
                "lightningRemote": try amount(4), "channelPending": try amount(7),
                "splicePending": String(channels.integers[1002] ?? 0)]
    }

    public func walletActivity(_ kind: String, offset: UInt64) async throws -> [String: Any] {
        if kind == "funding" {
            // Keep the native default range: genesis through mempool. Page the
            // chronologically sorted result rather than silently excluding mempool rows.
            let data = try await rpc { LndmobileGetTransactions(Data(), $0) }
            let all = try LightningWalletActivity.funding(data).sorted { $0.timestamp > $1.timestamp }
            guard offset <= UInt64(Int.max) else { throw NodeFailure.invalidReply }
            let rows = Array(all.dropFirst(Int(offset)).prefix(100))
            return ["rows": rows.map(\.dictionary), "next": String(offset + UInt64(rows.count)),
                    "more": offset + UInt64(rows.count) < UInt64(all.count)]
        }
        let incoming = kind == "invoices"
        guard incoming || kind == "payments" else { throw NodeFailure.invalidReply }
        let request = incoming
            ? ProtoFields.field(4, integer: offset) + ProtoFields.field(5, integer: 100) + ProtoFields.field(6, integer: 1)
            : ProtoFields.field(1, integer: 1) + ProtoFields.field(2, integer: offset) +
                ProtoFields.field(3, integer: 100) + ProtoFields.field(4, integer: 1) + ProtoFields.field(8, integer: 1)
        let data = try await rpc { callback in
            if incoming { LndmobileListInvoices(request, callback) }
            else { LndmobileListPayments(request, callback) }
        }
        let rows = try incoming ? LightningWalletActivity.invoices(data, now: UInt64(Date().timeIntervalSince1970)) : LightningWalletActivity.payments(data)
        return ["rows": rows.map(\.dictionary), "next": String(try ProtoFields(data).integers[incoming ? 3 : 2] ?? 0), "more": rows.count == 100]
    }
}
