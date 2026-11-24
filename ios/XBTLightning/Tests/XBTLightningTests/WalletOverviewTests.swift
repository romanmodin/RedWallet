import Foundation
import XCTest
@testable import XBTLightning

final class WalletOverviewTests: XCTestCase {
    private func field(_ n: UInt64, _ value: UInt64) -> Data { ProtoFields.field(n, integer: value) }
    private func string(_ n: UInt64, _ value: String) -> Data { ProtoFields.field(n, data: Data(value.utf8)) }
    private func row(_ value: Data) -> Data { ProtoFields.field(1, data: value) }

    func testPaymentUsesActualStatusAndNanosecondTimestampWithoutLeakingSecretOrRoutes() throws {
        let payment = string(1, "payment-hash") + field(7, 500) + field(11, 2) + field(10, 2) +
            field(13, 1_700_000_000_000_000_000) + string(6, "private-preimage")
        let result = try LightningWalletActivity.payments(row(payment))
        XCTAssertEqual(result.first?.sats, "500")
        XCTAssertEqual(result.first?.feeSats, "2")
        XCTAssertEqual(result.first?.timestamp, 1_700_000_000)
        XCTAssertEqual(result.first?.state, "settled")
        XCTAssertEqual(result.first?.direction, "sent")
        XCTAssertNil(result.first?.dictionary["preimage"])
        XCTAssertFalse(String(describing: result.first!.dictionary).contains("private-preimage"))
        for (status, expected) in [(UInt64(1), "pending"), (3, "failed"), (4, "pending"), (0, "unknown")] {
            let decoded = try LightningWalletActivity.payments(row(string(1, "hash") + field(10, status)))
            XCTAssertEqual(decoded.first?.state, expected)
        }
    }

    func testPaymentTraceReadsOnlyMatchingRecordAndRedactsRoute() throws {
        let hash = "synthetic-payment-hash"
        let base = string(1, hash) + field(15, 17) + field(10, 3) + field(16, 1)
        let route = ProtoFields.field(4, data: string(8, "private-peer"))
        let failure = field(1, 15) + field(8, 1)
        var attempt = field(1, 2) + ProtoFields.field(2, data: route)
        attempt += field(3, 11_000_000) + field(4, 17_000_000) + ProtoFields.field(5, data: failure)
        attempt += string(6, "private-preimage")
        let payment = base + field(13, 10_000_000) + ProtoFields.field(14, data: attempt)
        let report = try LightningPaymentTrace.report(page: row(payment), index: 17, hash: hash)
        XCTAssertTrue(report.contains("routing timed out"))
        XCTAssertTrue(report.contains("1 hop (direct) · sent +1 ms · resolved in 6 ms"))
        XCTAssertTrue(report.contains("temporary channel failure (15) · reported at hop 1"))
        for sensitive in [hash, "private-peer", "private-preimage"] { XCTAssertFalse(report.contains(sensitive)) }
        XCTAssertThrowsError(try LightningPaymentTrace.report(page: row(payment), index: 18, hash: hash))
        XCTAssertThrowsError(try LightningPaymentTrace.report(page: row(payment), index: 17, hash: "another"))
        let empty = try LightningPaymentTrace.report(page: row(base), index: 17, hash: hash)
        XCTAssertTrue(empty.contains("No route attempts retained"))
    }

    func testPrunedFailureCanShowOnlyItsOwnRecentRedactedStreamAttempts() throws {
        let hash = String(repeating: "a", count: 64)
        let key = string(1, hash) + field(15, 17)
        let failed = key + field(10, 3) + field(16, 1)
        let privateRoute = ProtoFields.field(4, data: string(8, "private-peer"))
        let reason = ProtoFields.field(5, data: field(1, 23))
        let attempt = field(1, 2) + ProtoFields.field(2, data: privateRoute) + reason + string(6, "secret")
        let detail = ProtoFields.field(14, data: attempt)
        let now = ContinuousClock().now
        let live = try XCTUnwrap(LightningPaymentTrace.StreamAttempts(response: failed + detail, expectedHash: hash,
                                                                       mainnet: true, now: now))
        func report(_ record: Data, _ index: UInt64 = 17, _ id: String? = nil,
                    mainnet: Bool = true, at time: ContinuousClock.Instant? = nil) throws -> String {
            try LightningPaymentTrace.report(page: row(record), index: index, hash: id ?? hash, mainnet: mainnet, stream: live, now: time ?? now)
        }

        let pruned = try report(failed)
        XCTAssertTrue(pruned.contains("Payment failure: routing timed out"))
        XCTAssertTrue(pruned.contains("Attempts observed during this send:"))
        XCTAssertTrue(pruned.contains("multipart payment timed out (23)"))
        for secret in [hash, "private-peer", "secret"] { XCTAssertFalse(pruned.contains(secret)) }

        let retained = try report(failed + ProtoFields.field(14, data: field(1, 2)))
        XCTAssertFalse(retained.contains("during this send"))
        XCTAssertFalse(retained.contains("multipart payment"))
        XCTAssertFalse(try report(key + field(10, 2)).contains("during this send"))
        XCTAssertTrue(try report(failed, mainnet: false).contains("No route attempts retained"))
        XCTAssertTrue(try report(failed, at: now.advanced(by: .seconds(300))).contains("No route attempts retained"))
        let otherHash = String(repeating: "b", count: 64)
        XCTAssertFalse(try report(string(1, otherHash) + field(15, 17) + field(10, 3), 17, otherHash).contains("during this send"))
        XCTAssertFalse(try report(string(1, hash) + field(15, 18) + field(10, 3), 18).contains("during this send"))
        XCTAssertThrowsError(try report(failed, 18))
        XCTAssertNil(try LightningPaymentTrace.StreamAttempts(response: failed, expectedHash: hash, mainnet: true))
        XCTAssertNil(try LightningPaymentTrace.StreamAttempts(response: failed + detail, expectedHash: otherHash, mainnet: true))
        XCTAssertNil(try LightningPaymentTrace.StreamAttempts(response: key + field(10, 2) + detail, expectedHash: hash, mainnet: true))
    }

    func testOnlyFailedOutgoingPaymentsIncludeTheRecordedFailureReason() throws {
        let hash = string(1, "synthetic-hash")
        let reason = field(16, 2)
        for status in [UInt64(1), 2, 3, 4] {
            let activity = try XCTUnwrap(LightningWalletActivity.payments(row(hash + field(10, status) + reason)).first)
            XCTAssertEqual(activity.dictionary["failureReasonCode"] as? UInt64, status == 3 ? 2 : nil)
        }
        let legacy = try XCTUnwrap(LightningWalletActivity.payments(row(hash + field(10, 3))).first)
        XCTAssertEqual(legacy.state, "failed")
        XCTAssertNil(legacy.dictionary["failureReasonCode"])
    }

    func testIncomingHistorySeparatesSettledAcceptedUnpaidExpiredAndCanceledInvoices() throws {
        let hash = ProtoFields.field(4, data: Data(repeating: 7, count: 32))
        let base = hash + field(5, 100) + field(7, 1000) + field(11, 3600)
        let settled = try LightningWalletActivity.invoices(row(base + field(21, 1) + field(19, 125) + field(8, 2000)), now: 5000)
        XCTAssertEqual(settled.first?.state, "settled")
        XCTAssertEqual(settled.first?.sats, "125")
        XCTAssertEqual(settled.first?.timestamp, 2000)
        XCTAssertEqual(settled.first?.direction, "received")
        XCTAssertEqual(try LightningWalletActivity.invoices(row(base), now: 2000).first?.state, "unpaid")
        XCTAssertEqual(try LightningWalletActivity.invoices(row(base), now: 4600).first?.state, "expired")
        XCTAssertEqual(try LightningWalletActivity.invoices(row(base + field(21, 2)), now: 2000).first?.state, "canceled")
        XCTAssertEqual(try LightningWalletActivity.invoices(row(base + field(21, 3) + field(19, 100)), now: 5000).first?.state, "pending")
        XCTAssertThrowsError(try LightningWalletActivity.invoices(row(field(5, 100)), now: 2000))
    }

    func testFundingReadsSignedAmountsAndActualConfirmations() throws {
        let outgoing = string(1, "funding-tx") + field(2, UInt64(bitPattern: -100156)) + field(3, 2) + field(6, 1234) + field(7, 156)
        let decoded = try LightningWalletActivity.funding(row(outgoing))
        XCTAssertEqual(decoded.first?.direction, "sent")
        XCTAssertEqual(decoded.first?.sats, "100156")
        XCTAssertEqual(decoded.first?.confirmations, 2)
        XCTAssertEqual(decoded.first?.feeSats, "156")
        XCTAssertEqual(decoded.first?.state, "confirmed")
        let pending = try LightningWalletActivity.funding(row(string(1, "deposit") + field(2, 1000000)))
        XCTAssertEqual(pending.first?.direction, "received")
        XCTAssertEqual(pending.first?.state, "pending")
        XCTAssertEqual(pending.first?.confirmations, 0)
    }
}
