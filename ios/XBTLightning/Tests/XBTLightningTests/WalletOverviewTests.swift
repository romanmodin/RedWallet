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
