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
    public let failureReasonCode: UInt64?

    var paymentIndex: UInt64? = nil

    public var dictionary: [String: Any] {
        var result: [String: Any] = ["id": id, "direction": direction, "sats": sats, "feeSats": feeSats,
                                   "timestamp": timestamp, "state": state, "memo": memo]
        if let paymentIndex, paymentIndex > 0 { result["paymentIndex"] = String(paymentIndex) }
        if let failureReasonCode { result["failureReasonCode"] = failureReasonCode }
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
                        memo: "", confirmations: nil, failureReasonCode: status == 3 ? row.integers[16] : nil, paymentIndex: row.integers[15])
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
                        state: state, memo: String(decoding: row.bytes[1]?.first ?? Data(), as: UTF8.self), confirmations: nil, failureReasonCode: nil)
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
                        memo: String(decoding: row.bytes[10]?.first ?? Data(), as: UTF8.self), confirmations: confirmations, failureReasonCode: nil)
        }
    }
}

enum LightningPaymentTrace {
    static func report(page: Data, index: UInt64, hash: String) throws -> String {
        let rows = try ProtoFields(page).bytes[1] ?? []
        guard rows.count == 1 else { throw NodeFailure.invalidReply }
        let payment = try ProtoFields(rows[0])
        guard payment.integers[15] == index, try payment.string(1) == hash else { throw NodeFailure.invalidReply }

        let state = [1: "in flight", 2: "settled", 3: "failed", 4: "initiated"][payment.integers[10] ?? 0] ?? "unknown"
        var lines = ["Outgoing Lightning payment", "Node status: " + state]
        if state == "failed", let reason = payment.integers[16] {
            let reasons: [UInt64: String] = [1: "routing timed out", 2: "no route", 3: "node error",
                4: "incorrect payment details", 5: "insufficient balance", 6: "canceled"]
            lines.append("Payment failure: " + (reasons[reason] ?? "code \(reason)"))
        }
        let attempts = payment.bytes[14] ?? []
        guard !attempts.isEmpty else {
            lines.append("No route attempts retained by the node.")
            return lines.joined(separator: "\n")
        }
        lines.append("Recorded attempts: \(attempts.count)")
        let start = max(0, attempts.count - 10)
        if start > 0 { lines.append("Showing the last 10.") }
        for i in start..<attempts.count {
            let attempt = try ProtoFields(attempts[i])
            let status = [0: "in flight", 1: "settled", 2: "failed"][attempt.integers[1] ?? 0] ?? "unknown"
            var parts = ["Attempt \(i + 1): " + status]
            if let rawRoute = attempt.bytes[2]?.first {
                let hops = try ProtoFields(rawRoute).bytes[4]?.count ?? 0
                if hops > 0 { parts.append(hops == 1 ? "1 hop (direct)" : "\(hops) hops") }
            }
            if let sent = attempt.integers[3], sent > 0 {
                if let created = payment.integers[13], created > 0, sent >= created {
                    parts.append("sent +\((sent - created) / 1_000_000) ms")
                }
                if let resolved = attempt.integers[4], resolved >= sent {
                    parts.append("resolved in \((resolved - sent) / 1_000_000) ms")
                }
            }
            if let rawFailure = attempt.bytes[5]?.first {
                let failure = try ProtoFields(rawFailure)
                if let code = failure.integers[1] {
                    let label = failureNames[code] ?? "unrecognized failure"
                    parts.append("\(label) (\(code))")
                }
                if let hop = failure.integers[8], hop > 0 { parts.append("reported at hop \(hop)") }
            }
            lines.append(parts.joined(separator: " · "))
        }
        return lines.joined(separator: "\n")
    }

    private static let failureNames: [UInt64: String] = [
        1: "incorrect or unknown payment details", 2: "incorrect payment amount", 3: "incorrect final CLTV expiry",
        4: "incorrect final HTLC amount", 5: "final expiry too soon", 6: "invalid realm",
        7: "expiry too soon", 8: "invalid Lightning onion version", 9: "invalid Lightning onion HMAC", 10: "invalid Lightning onion key",
        11: "amount below minimum", 12: "fee insufficient", 13: "incorrect CLTV expiry", 14: "channel disabled",
        15: "temporary channel failure", 16: "required node feature missing", 17: "required channel feature missing",
        18: "unknown next peer", 19: "temporary node failure", 20: "permanent node failure", 21: "permanent channel failure",
        22: "expiry too far", 23: "multipart payment timed out", 24: "invalid Lightning onion payload", 25: "invalid Lightning onion blinding",
        997: "internal failure", 998: "unknown failure", 999: "unreadable failure"
    ]
}

// An estimate of active outgoing liquidity, never a routing guarantee.
// local_balance already excludes committed outgoing HTLCs and commitment fees.
// Reserve an additional fee buffer for the funder; offline channels contribute zero.
enum LightningLiquidity {
    static func available(_ data: Data) throws -> UInt64 {
        var total: UInt64 = 0
        for bytes in try ProtoFields(data).bytes[11] ?? [] {
            let row = try ProtoFields(bytes)
            guard row.integers[1] == 1 else { continue }
            let local = row.integers[6] ?? 0
            let constraints = try ProtoFields(row.bytes[29]?.first ?? Data())
            let reserve = constraints.integers[2] ?? row.integers[20] ?? 0
            let fee = row.integers[18] == 1 ? row.integers[8] ?? 0 : 0
            guard local <= LightningAmounts.maxSats, reserve <= LightningAmounts.maxSats,
                  fee <= LightningAmounts.maxSats else { throw NodeFailure.invalidReply }
            let deductions = reserve + fee * 2
            let available = local > deductions ? local - deductions : 0
            guard total <= LightningAmounts.maxSats - available else { throw NodeFailure.invalidReply }
            total += available
        }
        return total
    }
}

extension RegtestNode {
    public func paymentTrace(index: UInt64, hash: String) async throws -> String {
        guard index > 0 else { throw NodeFailure.invalidReply }
        let request = ProtoFields.field(1, integer: 1) + ProtoFields.field(2, integer: index - 1) +
            ProtoFields.field(3, integer: 1)
        let page = try await rpc { LndmobileListPayments(request, $0) }
        return try LightningPaymentTrace.report(page: page, index: index, hash: hash)
    }

    public func walletOverview() async throws -> [String: Any] {
        let info = try ProtoFields(await XBTLightningNode.info())
        let wallet = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) })
        let channels = try ProtoFields(await rpc { LndmobileChannelBalance(Data(), $0) })
        func amount(_ field: UInt64) throws -> String {
            String(try ProtoFields(channels.bytes[field]?.first ?? Data()).integers[1] ?? 0)
        }
        let open = try await rpc { LndmobileListChannels(Data(), $0) }
        return ["node": try info.string(1), "synced": info.integers[9] == 1,
                "peers": String(info.integers[5] ?? 0), "height": String(info.integers[6] ?? 0), "activeChannels": String(info.integers[4] ?? 0),
                "fundingTotal": String(wallet.integers[1] ?? 0), "fundingConfirmed": String(wallet.integers[2] ?? 0),
                "fundingPending": String(wallet.integers[3] ?? 0), "fundingLocked": String(wallet.integers[5] ?? 0),
                "anchorReserve": String(wallet.integers[6] ?? 0), "lightningLocal": try amount(3),
                "lightningRemote": try amount(4), "channelPending": try amount(7),
                "splicePending": String(channels.integers[1002] ?? 0),
                "lightningAvailable": String(try LightningLiquidity.available(open))]
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
