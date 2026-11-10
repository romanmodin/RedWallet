import Foundation
import Lndmobile

extension ProtoFields {
    // Proto3 omits default empty strings. Keep required identifiers strict while
    // allowing explicitly optional refusal/progress/transaction fields to be absent.
    func optionalString(_ number: UInt64) throws -> String {
        guard let value = bytes[number]?.first else { return "" }
        guard let text = String(data: value, encoding: .utf8) else { throw NodeFailure.invalidReply }
        return text
    }
}

public enum SpliceFailure: LocalizedError {
    case unavailable(String), changed, reviewExpired, outcomeUnknown
    public var errorDescription: String? {
        switch self {
        case .unavailable(let reason): return "Channel resize unavailable: " + reason
        case .changed: return "Channel balance or fees changed. Review the resize again."
        case .reviewExpired: return "This channel resize review expired or was already used. Review again."
        case .outcomeUnknown: return "Resize outcome unknown. Refresh channels before taking another action. Do not repeat the resize."
        }
    }
}

public struct SpliceChannelState: Sendable {
    public let status: String
    public let progress: String
    public let txid: String
    public let confirmations: UInt64
    public let lockDepth: UInt64
    public var onchainConfirmations: Int64? = nil
    public var weLocked: Bool? = nil
    public var peerLocked: Bool? = nil
    static func decode(_ channel: ProtoFields, awaitingNewAttempt: Bool = false) throws -> SpliceChannelState {
        let pending = try ProtoFields(channel.bytes[1003]?.first ?? Data())
        let last = try ProtoFields(channel.bytes[1004]?.first ?? Data())
        let hasPending = channel.bytes[1003]?.first != nil
        // SpliceChannel first reports preparing, before ListChannels necessarily
        // publishes its pending record. A previous locked splice is not evidence
        // that this newly submitted attempt has finished or may be submitted again.
        if awaitingNewAttempt && !hasPending {
            return SpliceChannelState(status: "awaiting_update", progress: "awaiting_update",
                                      txid: "", confirmations: 0, lockDepth: 0)
        }
        var result = SpliceChannelState(status: try channel.optionalString(1002),
            progress: hasPending ? try pending.optionalString(2) : try last.optionalString(6),
            txid: hasPending ? try pending.optionalString(8) : try last.optionalString(4),
            confirmations: pending.integers[10] ?? 0, lockDepth: pending.integers[11] ?? 0)
        if hasPending {
            result.weLocked = pending.integers[12] == 1
            result.peerLocked = pending.integers[13] == 1
        } else if result.progress == "locked" {
            result.weLocked = true
            result.peerLocked = true
        }
        return result
    }

    // Exact txid only. Never infer depth from broadcast height, keep the maximum
    // seen, or reuse the channel's original funding transaction after a reorg.
    static func transactionConfirmations(_ data: Data) throws -> [String: Int64] {
        var result: [String: Int64] = [:]
        for bytes in try ProtoFields(data).bytes[1] ?? [] {
            let row = try ProtoFields(bytes)
            result[try row.string(1)] = Int64(bitPattern: row.integers[3] ?? 0)
        }
        return result
    }
    static func permits(_ status: String) -> Bool { status == "ok" || status == "peer_not_announcing" }
}

public struct SpliceEstimate: Equatable, Sendable {
    public let fee: UInt64
    public let feeRate: UInt64
    public let sats: UInt64
    public let capacity: UInt64
    public let local: UInt64
    public let lockDepth: UInt64
    static func decode(_ data: Data, sats: UInt64, feeRate: UInt64, removing: Bool) throws -> SpliceEstimate {
        let f = try ProtoFields(data)
        let refusal = try f.optionalString(15)
        guard refusal.isEmpty else {
            let message: String
            switch refusal {
            case "below_min": message = "minimum amount is \(f.integers[5] ?? 0) sats"
            case "above_max_out": message = "at most \(f.integers[7] ?? 0) sats can be removed after fees and reserves"
            case "fee_below_floor": message = "fee rate must be at least \(f.integers[8] ?? 0) sat/vB"
            case "insufficient_funds", "immature_inputs": message = "not enough confirmed on-chain funds to add this amount and pay the fee"
            default: message = refusal.replacingOccurrences(of: "_", with: " ")
            }
            throw SpliceFailure.unavailable(message)
        }
        func unsigned(_ key: UInt64, maximum: UInt64 = LightningAmounts.maxSats) throws -> UInt64 {
            let v = f.integers[key] ?? 0
            guard Int64(bitPattern: v) >= 0, v <= maximum else { throw NodeFailure.invalidReply }
            return v
        }
        let fee = try unsigned(1), rate = try unsigned(3, maximum: LightningAmounts.maxFeeRate), amount = try unsigned(4)
        let capacity = try unsigned(11), local = try unsigned(12), depth = try unsigned(13)
        guard fee > 0, rate == feeRate, amount == sats, capacity > 0, local <= capacity,
              depth > 0, !removing || f.integers[14] == 1 else { throw NodeFailure.invalidReply }
        return SpliceEstimate(fee: fee, feeRate: rate, sats: amount, capacity: capacity, local: local, lockDepth: depth)
    }
}

public struct SpliceReview: Sendable {
    public let token: String
    public let point: String
    public let direction: String
    public let address: String
    public let estimate: SpliceEstimate
    let request: Data
    let created: Date
    public var dictionary: [String: String] {
        ["token": token, "point": point, "direction": direction, "address": address,
         "sats": String(estimate.sats), "fee": String(estimate.fee), "feeRate": String(estimate.feeRate),
         "capacity": String(estimate.capacity), "local": String(estimate.local), "lockDepth": String(estimate.lockDepth)]
    }
}

struct SpliceReviews {
    private var reviews: [String: SpliceReview] = [:]
    mutating func save(_ review: SpliceReview) { reviews = [review.token: review] }
    mutating func consume(_ token: String, now: Date = Date()) throws -> SpliceReview {
        guard let review = reviews.removeValue(forKey: token), now.timeIntervalSince(review.created) >= 0,
              now.timeIntervalSince(review.created) < 120 else { throw SpliceFailure.reviewExpired }
        return review
    }
}

extension RegtestNode {
    static func spliceRequest(point: String, direction: String, sats: UInt64, feeRate: UInt64, address: String) throws -> Data {
        let parts = point.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, parts[0].count == 64, let index = UInt32(parts[1]),
              parts[0].utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }),
              direction == "in" || direction == "out", LightningAmounts.valid(sats),
              LightningAmounts.validFeeRate(feeRate), direction == "out" || address.isEmpty else { throw NodeFailure.invalidAmount }
        let channel = ProtoFields.field(2, data: Data(parts[0].utf8)) + ProtoFields.field(3, integer: UInt64(index))
        var request = ProtoFields.field(1, data: channel) + ProtoFields.field(2, integer: direction == "out" ? 1 : 0) +
            ProtoFields.field(3, integer: sats) + ProtoFields.field(5, integer: feeRate)
        if !address.isEmpty { request += ProtoFields.field(7, data: Data(address.utf8)) }
        // Never set use_max or force_low_fee.
        return request
    }

    private func requireSpliceReady(_ point: String) async throws {
        try await requireSynced()
        guard !closingPoints.contains(point) else { throw SpliceFailure.unavailable("channel is closing") }
        guard let channel = try await channelStatus().first(where: { $0.point == point }),
              channel.state == "active", let splice = channel.splice else { throw SpliceFailure.unavailable("channel is not active") }
        // If the stream was lost, an authoritative terminal channel snapshot can
        // release the local guard. A timeout or missing status alone cannot.
        if splicingPoints.contains(point) {
            guard SpliceChannelState.permits(splice.status), ["locked", "aborted", "dead"].contains(splice.progress) else {
                throw SpliceFailure.outcomeUnknown
            }
            splicingPoints.remove(point)
        }
        guard SpliceChannelState.permits(splice.status) else {
            throw SpliceFailure.unavailable(splice.status.isEmpty ? "not supported by this channel" : splice.status)
        }
    }

    public func reviewSplice(point: String, direction: String, sats: UInt64, feeRate: UInt64) async throws -> SpliceReview {
        guard !managementBusy else { throw SpliceFailure.unavailable("another operation is running") }
        managementBusy = true
        defer { managementBusy = false }
        try await requireSpliceReady(point)
        guard direction == "in" || direction == "out" else { throw NodeFailure.invalidAmount }
        let address = direction == "out" ? try await fundingAddress() : ""
        let request = try Self.spliceRequest(point: point, direction: direction, sats: sats, feeRate: feeRate, address: address)
        let estimate = try SpliceEstimate.decode(await rpc { LndmobileEstimateSplice(request, $0) },
            sats: sats, feeRate: feeRate, removing: direction == "out")
        let review = SpliceReview(token: UUID().uuidString, point: point, direction: direction, address: address,
                                  estimate: estimate, request: request, created: Date())
        spliceReviews.save(review)
        return review
    }

    public func splice(token: String) async throws -> String {
        guard !managementBusy else { throw SpliceFailure.unavailable("another operation is running") }
        let review = try spliceReviews.consume(token)
        managementBusy = true
        defer { managementBusy = false }
        try await requireSpliceReady(review.point)
        let current = try SpliceEstimate.decode(await rpc { LndmobileEstimateSplice(review.request, $0) },
            sats: review.estimate.sats, feeRate: review.estimate.feeRate, removing: review.direction == "out")
        guard current == review.estimate else { throw SpliceFailure.changed }
        splicingPoints.insert(review.point)
        // One submission only. An error/timeout does not establish that LND stopped.
        // LND owns persistence/recovery of the splice across disconnects/restarts.
        do {
            let result = try await rpc { reply in
                LndmobileSpliceChannel(review.request, SpliceStream(reply: reply) { state in
                    Task { await self.spliceFinished(point: review.point, state: state) }
                })
            }
            return String(decoding: result, as: UTF8.self)
        } catch let error as SpliceFailure { throw error }
        catch { throw SpliceFailure.outcomeUnknown }
    }

    private func spliceFinished(point: String, state: String) {
        if state == "locked" || state == "aborted" { splicingPoints.remove(point) }
    }
}

private final class SpliceStream: NSObject, LndmobileRecvStreamProtocol {
    let reply: LndmobileCallbackProtocol
    let observe: @Sendable (String) -> Void
    init(reply: LndmobileCallbackProtocol, observe: @escaping @Sendable (String) -> Void) {
        self.reply = reply; self.observe = observe
    }
    func onError(_ error: Error?) { reply.onError(SpliceFailure.outcomeUnknown) }
    func onResponse(_ response: Data?) {
        do {
            let fields = try ProtoFields(response ?? Data())
            let state = try fields.string(1)
            guard ["preparing", "negotiating", "signed", "broadcast", "confirmed", "locked", "aborted"].contains(state) else {
                throw NodeFailure.invalidReply
            }
            observe(state)
            if state == "aborted" { reply.onError(SpliceFailure.unavailable(try fields.optionalString(5))); return }
            let txid = try fields.optionalString(2)
            reply.onResponse(Data(("Resize " + state + (txid.isEmpty ? "" : " · " + txid) +
                ". Refresh channels to follow progress. Funds become available after the splice locks.").utf8))
        } catch { reply.onError(error) }
    }
}
