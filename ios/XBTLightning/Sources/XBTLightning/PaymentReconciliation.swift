import Foundation
import CryptoKit
import Lndmobile

// A SendPaymentV2 stream can stay silent after the router has already recorded a
// terminal failure (for example no_route). The payment database is authoritative,
// so one exact-hash lookup resolves an unanswered send without resubmitting.
enum PaymentReconciliation {
    enum Outcome: Equatable { case settled, failed, pending }

    // Classify only an authoritative terminal row for this exact hash. A missing,
    // duplicate, in-flight, unknown or unverifiable row stays pending.
    static func classify(rows: [Data], hash: String) -> Outcome {
        let matches = rows.compactMap { data -> ProtoFields? in
            guard let row = try? ProtoFields(data), (try? row.string(1)) == hash else { return nil }
            return row
        }
        guard matches.count == 1, let row = matches.first else { return .pending }
        switch row.integers[10] {
        case 3: return .failed
        case 2: return verified(row, hash: hash) ? .settled : .pending
        default: return .pending
        }
    }

    private static func verified(_ row: ProtoFields, hash: String) -> Bool {
        guard let proof = try? BridgePaymentValidation.hex(row.string(6), count: 32),
              let expected = try? BridgePaymentValidation.hex(hash, count: 32) else { return false }
        return Data(SHA256.hash(data: proof)) == expected
    }

    // One submission only. A timed-out send is reconciled with one bounded lookup;
    // every other error, and every ambiguous lookup, keeps the original uncertainty.
    static func settled(hash: String, send: () async throws -> Data, lookup: () async throws -> [Data]) async throws -> Bool {
        do {
            let result = try ProtoFields(await send())
            guard try result.string(1) == hash else { throw NodeFailure.invalidReply }
            return result.integers[10] == 2
        } catch NodeFailure.timedOut {
            guard let rows = try? await lookup() else { throw NodeFailure.timedOut }
            switch classify(rows: rows, hash: hash) {
            case .settled: return true
            case .failed: return false
            case .pending: throw NodeFailure.timedOut
            }
        }
    }
}

extension PaymentReconciliation {
    static func monotonicSeconds() -> TimeInterval {
        TimeInterval(DispatchTime.now().uptimeNanoseconds) / 1_000_000_000
    }

    // Exact-hash scan, newest first, bounded to 200 pages. One monotonic budget covers
    // the whole scan: each page gets only the time that remains, and an exhausted
    // budget is a timeout (which the caller keeps pending) without another page RPC.
    static func scan(hash: String, budget: TimeInterval, now: () -> TimeInterval = monotonicSeconds,
                     page fetch: (_ cursor: UInt64, _ remaining: TimeInterval) async throws -> Data) async throws -> [Data] {
        let start = now()
        var cursor: UInt64 = 0
        for _ in 0..<200 {
            let remaining = budget - (now() - start)
            guard remaining > 0 else { throw NodeFailure.timedOut }
            let page = try ProtoFields(await fetch(cursor, remaining))
            let rows = page.bytes[1] ?? []
            guard rows.count <= 100 else { throw NodeFailure.invalidReply }
            let matching = try rows.filter { try ProtoFields($0).string(1) == hash }
            if !matching.isEmpty || rows.count < 100 { return matching }
            guard let next = page.integers[2], next > 0, cursor == 0 || next < cursor else { throw NodeFailure.invalidReply }
            cursor = next
        }
        throw NodeFailure.invalidReply
    }
}

extension RegtestNode {
    // `timeout` is the total budget for the whole lookup, not a per-page allowance.
    func paymentRows(hash: String, timeout: TimeInterval = 15) async throws -> [Data] {
        try await PaymentReconciliation.scan(hash: hash, budget: timeout) { cursor, remaining in
            let request = ProtoFields.field(1, integer: 1) + ProtoFields.field(2, integer: cursor) +
                ProtoFields.field(3, integer: 100) + ProtoFields.field(4, integer: 1) + ProtoFields.field(8, integer: 1)
            return try await rpc(timeout: remaining) { LndmobileListPayments(request, $0) }
        }
    }
}
