import Foundation
import XCTest
@testable import XBTLightning

final class PeerFundingHistoryTests: XCTestCase {
    private func text(_ field: UInt64, _ string: String) -> Data {
        ProtoFields.field(field, data: Data(string.utf8))
    }

    private func snapshot(_ point: String, us: Bool = true, capacity: UInt64 = 200, extra: Data = Data()) throws -> FundingSnapshot {
        let fields = text(1005, "open:0") + ProtoFields.field(5, integer: capacity) + ProtoFields.field(18, integer: us ? 1 : 0)
        return try XCTUnwrap(FundingSnapshot(ProtoFields(fields + extra), point: point))
    }

    private func transaction(_ id: String, amount: UInt64, inputs: [(String, Bool)]) -> Data {
        let output = ProtoFields.field(1, integer: 3) + ProtoFields.field(5, integer: amount)
        var raw = text(1, id) + ProtoFields.field(3, integer: 10) + ProtoFields.field(11, data: output)
        for (point, ours) in inputs {
            raw += ProtoFields.field(12, data: text(1, point) + ProtoFields.field(2, integer: ours ? 1 : 0))
        }
        return ProtoFields.field(1, data: raw)
    }

    func testOlderChannelsRecoverDepositsAndOpeningFromActualFundingOutputs() throws {
        let txs = transaction("open", amount: 100, inputs: []) +
            transaction("our", amount: 150, inputs: [("open:0", false), ("ours:1", true)]) +
            transaction("peer", amount: 200, inputs: [("our:0", false), ("theirs:1", false)])
        var syncing = FundingJournal()
        let unsynced = syncing.update(try snapshot("peer:0", us: false), transactions: FundingTransactions(txs))
        XCTAssertFalse(unsynced.complete)
        XCTAssertNil(unsynced.changes.first?.change.peerDelta)
        let history = FundingTransactions(txs, walletSynced: true)
        var journal = FundingJournal()
        let channel = try snapshot("peer:0", us: false, extra: ProtoFields.field(7, integer: 17))
        let report = journal.update(channel, transactions: history)
        XCTAssertTrue(report.complete)
        XCTAssertEqual(report.opening, 100)
        XCTAssertEqual(report.changes.map { $0.change.peerDelta }, [50, 0])
        var reloaded = try JSONDecoder().decode(FundingJournal.self, from: JSONEncoder().encode(journal))
        let next = reloaded.update(channel, transactions: FundingTransactions(nil))
        XCTAssertTrue(next.complete)
        XCTAssertEqual(next.changes.map { $0.change.peerDelta }, [50, 0])
    }

    func testPendingIsCountedOnlyAtItsExactLockedOutpointAndOnlyOnce() throws {
        var journal = FundingJournal()
        let pending = text(8, "next") + text(17, "next:1") + ProtoFields.field(4, integer: 42)
        let empty = FundingTransactions(nil)
        let opening = try snapshot("open:0", extra: ProtoFields.field(1003, data: pending))
        let first = journal.update(opening, transactions: empty)
        XCTAssertEqual(first.opening, 0)
        XCTAssertTrue(first.changes.isEmpty)
        for balance: UInt64 in [42, 99, 30] {
            let locked = try snapshot("next:1", extra: ProtoFields.field(7, integer: balance))
            let report = journal.update(locked, transactions: empty)
            XCTAssertTrue(report.complete)
            XCTAssertEqual(report.changes.map { $0.change.peerDelta }, [42])
        }
    }

    func testMissingHistoryAndAbortedSplicesNeverBecomeZeroOrAContribution() throws {
        var journal = FundingJournal()
        let aborted = text(4, "next") + text(6, "aborted") + ProtoFields.field(3, integer: 99)
        let failed = try snapshot("next:0", us: false, extra: ProtoFields.field(1004, data: aborted))
        let report = journal.update(failed, transactions: FundingTransactions(nil))
        XCTAssertFalse(report.complete)
        XCTAssertNil(report.opening)
        XCTAssertNil(report.changes.first?.change.peerDelta)
        let last = text(4, "next") + text(6, "locked") + ProtoFields.field(3, integer: UInt64(bitPattern: -50))
        let updated = try snapshot("next:0", extra: ProtoFields.field(1004, data: last))
        let partial = journal.update(updated, transactions: FundingTransactions(nil))
        XCTAssertEqual(partial.changes.first?.change.peerDelta, -50)
        XCTAssertFalse(partial.complete)
        let replacement = journal.update(try snapshot("other:2"), transactions: FundingTransactions(nil))
        XCTAssertNil(replacement.changes.first?.change.peerDelta)
    }

    func testUnattributedWithdrawalsAndMixedInputsStayUnknown() throws {
        let txs = transaction("open", amount: 100, inputs: []) +
            transaction("withdraw", amount: 80, inputs: [("open:0", false)]) +
            transaction("mixed", amount: 200, inputs: [("withdraw:0", false), ("us:0", true), ("them:1", false)])
        var journal = FundingJournal()
        let result = journal.update(try snapshot("mixed:0"), transactions: FundingTransactions(txs, walletSynced: true))
        XCTAssertFalse(result.complete)
        XCTAssertEqual(result.changes.map { $0.change.peerDelta }, [nil, nil])
    }
}
