import Foundation
import CryptoKit
import Lndmobile
import UIKit

public enum BridgePaymentFailure: LocalizedError {
    case liquidity
    public var errorDescription: String? { "Insufficient available XBT Lightning liquidity for this quote and routing fee limit." }
}

struct BridgePaymentReview: Codable, Sendable {
    let invoice: String
    let hash: String
    let msat: String
    let feeLimit: String
    let destination: String
    let node: String
    let expiresAt: UInt64
}
enum BridgePaymentValidation {
    static func hex(_ value: String, count: Int) throws -> Data {
        guard value.utf8.count == count * 2, value.utf8.allSatisfy({ (48...57).contains($0) || (97...102).contains($0) }) else { throw NodeFailure.invalidReply }
        return Data(try stride(from: 0, to: value.count, by: 2).map { offset in
            let start = value.index(value.startIndex, offsetBy: offset)
            guard let byte = UInt8(value[start..<value.index(start, offsetBy: 2)], radix: 16) else { throw NodeFailure.invalidReply }
            return byte
        })
    }
    static func decoded(_ data: Data, review: BridgePaymentReview, now: UInt64) throws -> UInt64 {
        let decoded = try ProtoFields(data)
        let features = try (decoded.bytes[13] ?? []).map { try ProtoFields($0).integers[1] }
        guard review.invoice.hasPrefix("lnbc"), !review.invoice.hasPrefix("lnbcrt"), review.invoice.utf8.count <= 8192,
              let amount = UInt64(review.msat), amount > 0, amount <= LightningAmounts.maxSats * 1000,
              let fee = UInt64(review.feeLimit), LightningAmounts.valid(fee),
              try decoded.string(1) == review.destination, try decoded.string(2) == review.hash,
              decoded.integers[12] == amount, features.contains(512) || features.contains(513),
              let timestamp = decoded.integers[4], let expiry = decoded.integers[5],
              timestamp <= UInt64.max - expiry, timestamp + expiry >= now + 15,
              review.expiresAt >= now + 15, review.expiresAt <= timestamp + expiry,
              (decoded.integers[9] ?? 18) <= 2016 else { throw PaymentSubmissionFailure.invalidReview }
        _ = try hex(review.hash, count: 32)
        _ = try hex(review.destination, count: 33)
        return amount
    }
    static func payment(_ data: Data, hash: String) throws -> [String: Any] {
        let row = try ProtoFields(data)
        guard try row.string(1) == hash else { throw NodeFailure.invalidReply }
        let state = [1: "pending", 2: "settled", 3: "failed", 4: "pending"][row.integers[10] ?? 0] ?? "unknown"
        if state == "settled" {
            let preimage = try hex(row.string(6), count: 32)
            guard Data(SHA256.hash(data: preimage)) == (try hex(hash, count: 32)) else { throw NodeFailure.invalidReply }
        }
        return ["state": state, "proofVerified": state == "settled", "msat": String(row.integers[8] ?? 0),
                "feeMsat": String(row.integers[12] ?? 0)]
    }
}
private final class BridgePaymentResult: NSObject, LndmobileRecvStreamProtocol {
    let reply: LndmobileCallbackProtocol
    init(_ reply: LndmobileCallbackProtocol) { self.reply = reply }
    func onError(_ error: Error?) { reply.onError(error ?? NodeFailure.invalidReply) }
    func onResponse(_ response: Data?) {
        do {
            let fields = try ProtoFields(response ?? Data())
            if fields.integers[10] == 2 || fields.integers[10] == 3 { reply.onResponse(response) }
        } catch { reply.onError(error) }
    }
}
extension RegtestNode {
    public func bridgePaymentStatus(hash: String) async throws -> [String: Any] {
        _ = try BridgePaymentValidation.hex(hash, count: 32)
        var cursor: UInt64 = 0
        for _ in 0..<200 {
            let request = ProtoFields.field(1, integer: 1) + ProtoFields.field(2, integer: cursor) +
                ProtoFields.field(3, integer: 100) + ProtoFields.field(4, integer: 1) + ProtoFields.field(8, integer: 1)
            let page = try ProtoFields(await rpc { LndmobileListPayments(request, $0) })
            let rows = page.bytes[1] ?? []
            guard rows.count <= 100 else { throw NodeFailure.invalidReply }
            for data in rows where try ProtoFields(data).string(1) == hash {
                return try BridgePaymentValidation.payment(data, hash: hash)
            }
            if rows.count < 100 { return ["state": "not_found", "proofVerified": false] }
            guard let next = page.integers[2], next > 0, cursor == 0 || next < cursor else { throw NodeFailure.invalidReply }
            cursor = next
        }
        throw NodeFailure.invalidReply
    }
    private func validatedBridgeReview(_ json: String) async throws -> (BridgePaymentReview, UInt64) {
        guard mainnet, json.utf8.count <= 12000 else { throw PaymentSubmissionFailure.invalidReview }
        let review = try JSONDecoder().decode(BridgePaymentReview.self, from: Data(json.utf8))
        let info = try ProtoFields(await XBTLightningNode.info())
        guard try info.string(1) == review.node else { throw PaymentSubmissionFailure.invalidReview }
        let decoded = try await rpc { LndmobileDecodePayReq(ProtoFields.field(1, data: Data(review.invoice.utf8)), $0) }
        let amount = try BridgePaymentValidation.decoded(decoded, review: review, now: UInt64(Date().timeIntervalSince1970))
        return (review, amount)
    }
    public func reviewBridgePayment(_ json: String) async throws -> [String: Any] {
        let (review, amount) = try await validatedBridgeReview(json)
        try await requireSynced()
        let overview = try await walletOverview()
        guard let available = overview["lightningAvailable"] as? String, let balance = UInt64(available),
              let fee = UInt64(review.feeLimit), balance * 1000 >= amount + fee * 1000 else { throw BridgePaymentFailure.liquidity }
        // Graph-only estimate: no invoice probe and no HTLC before approval.
        let request = ProtoFields.field(1, data: try BridgePaymentValidation.hex(review.destination, count: 33)) +
            ProtoFields.field(2, integer: (amount + 999) / 1000)
        var result: [String: Any] = ["node": review.node, "availableMsat": String(balance * 1000)]
        if let data = try? await rpc({ LndmobileRouterEstimateRouteFee(request, $0) }),
           let estimate = try? ProtoFields(data), (estimate.integers[5] ?? 0) == 0, let feeMsat = estimate.integers[1],
           feeMsat <= LightningAmounts.maxSats * 1000 {
            result["estimatedFeeMsat"] = String(feeMsat)
        }
        return result
    }
    public func payBridgeInvoice(_ json: String) async throws -> [String: Any] {
        let foregroundEpoch = try await MainActor.run {
            guard UIApplication.shared.applicationState == .active else { throw PaymentSubmissionFailure.invalidReview }
            return LightningBackgroundTime.shared.paymentForegroundEpoch
        }
        let review: BridgePaymentReview
        do {
            let validated = try await validatedBridgeReview(json)
            review = validated.0
            try await requireSynced()
            let previous = try await bridgePaymentStatus(hash: review.hash)
            guard previous["state"] as? String == "not_found" || previous["state"] as? String == "failed" else { return previous }
        } catch {
            // All failures here precede SendPaymentV2. Errors below remain ambiguous.
            throw PaymentSubmissionFailure.invalidReview
        }
        let request = ProtoFields.field(5, data: Data(review.invoice.utf8)) + ProtoFields.field(6, integer: 30) +
            ProtoFields.field(7, integer: UInt64(review.feeLimit)!)
        let result = try await foregroundRPC {
            guard UIApplication.shared.applicationState == .active,
                  LightningBackgroundTime.shared.paymentForegroundEpoch == foregroundEpoch,
                  review.expiresAt >= UInt64(Date().timeIntervalSince1970) + 15 else { throw PaymentSubmissionFailure.invalidReview }
            LndmobileRouterSendPaymentV2(request, BridgePaymentResult($0))
        }
        return try BridgePaymentValidation.payment(result, hash: review.hash)
    }
}
