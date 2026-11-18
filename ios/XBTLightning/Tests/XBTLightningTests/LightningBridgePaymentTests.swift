import XCTest
import CryptoKit
@testable import XBTLightning

final class LightningBridgePaymentTests: XCTestCase {
    let node = "02" + String(repeating: "12", count: 32)
    let preimage = Data(repeating: 0x11, count: 32)
    var paymentHash: String { Data(SHA256.hash(data: preimage)).map { String(format: "%02x", $0) }.joined() }
    func review(msat: String = "102000340") -> BridgePaymentReview {
        BridgePaymentReview(invoice: "lnbc1fixture", hash: paymentHash, msat: msat, feeLimit: "10",
                            destination: node, node: node, expiresAt: 1120)
    }
    func decoded(hash: String? = nil, destination: String? = nil, feature: UInt64 = 512, msat: UInt64 = 102000340,
                 expiry: UInt64 = 120, cltv: UInt64 = 1200) -> Data {
        ProtoFields.field(1, data: Data((destination ?? node).utf8)) +
        ProtoFields.field(2, data: Data((hash ?? self.paymentHash).utf8)) +
        ProtoFields.field(4, integer: 1000) + ProtoFields.field(5, integer: expiry) +
        ProtoFields.field(9, integer: cltv) + ProtoFields.field(12, integer: msat) +
        ProtoFields.field(13, data: ProtoFields.field(1, integer: feature))
    }
    func payment(state: UInt64 = 2, proof: String? = nil) -> Data {
        ProtoFields.field(1, data: Data(paymentHash.utf8)) +
        ProtoFields.field(6, data: Data((proof ?? String(repeating: "11", count: 32)).utf8)) +
        ProtoFields.field(8, integer: 102000340) +
        ProtoFields.field(10, integer: state) + ProtoFields.field(12, integer: 1234)
    }
    func testExactFractionalMillisatoshisAndOptionalChainBit() throws {
        XCTAssertEqual(try BridgePaymentValidation.decoded(decoded(), review: review(), now: 1000), 102000340)
        XCTAssertEqual(try BridgePaymentValidation.decoded(decoded(feature: 513), review: review(), now: 1000), 102000340)
        XCTAssertThrowsError(try BridgePaymentValidation.decoded(decoded(msat: 102001000), review: review(), now: 1000))
    }
    func testWrongChainHashDestinationAndLongHoldAreRejected() {
        for data in [decoded(feature: 17), decoded(hash: String(repeating: "22", count: 32)),
                     decoded(destination: "03" + String(repeating: "22", count: 32)), decoded(cltv: 2017)] {
            XCTAssertThrowsError(try BridgePaymentValidation.decoded(data, review: review(), now: 1000))
        }
    }
    func testExpiredQuoteOrInvoiceCannotBeSubmitted() {
        XCTAssertThrowsError(try BridgePaymentValidation.decoded(decoded(), review: review(), now: 1106))
        XCTAssertThrowsError(try BridgePaymentValidation.decoded(decoded(expiry: 10), review: review(), now: 1000))
    }
    func testLocalSettlementRequiresTheCorrectPreimageAndReturnsExactFees() throws {
        let result = try BridgePaymentValidation.payment(payment(), hash: paymentHash)
        XCTAssertEqual(result["state"] as? String, "settled")
        XCTAssertEqual(result["proofVerified"] as? Bool, true)
        XCTAssertEqual(result["msat"] as? String, "102000340")
        XCTAssertEqual(result["feeMsat"] as? String, "1234")
        XCTAssertNil(result["preimage"], "Do not export proof secrets into general wallet history")
        XCTAssertThrowsError(try BridgePaymentValidation.payment(payment(proof: String(repeating: "22", count: 32)), hash: paymentHash))
    }
    func testPendingAndFailedCannotBeReportedAsSettled() throws {
        for (code, state) in [(UInt64(1), "pending"), (3, "failed"), (4, "pending"), (0, "unknown")] {
            let result = try BridgePaymentValidation.payment(payment(state: code, proof: ""), hash: paymentHash)
            XCTAssertEqual(result["state"] as? String, state)
            XCTAssertEqual(result["proofVerified"] as? Bool, false)
        }
    }
    func testWrongHashAndMalformedHexAreRejected() {
        XCTAssertThrowsError(try BridgePaymentValidation.payment(payment(), hash: String(repeating: "22", count: 32)))
        XCTAssertThrowsError(try BridgePaymentValidation.hex("xx", count: 1))
        XCTAssertThrowsError(try BridgePaymentValidation.hex("00", count: 32))
    }
}
