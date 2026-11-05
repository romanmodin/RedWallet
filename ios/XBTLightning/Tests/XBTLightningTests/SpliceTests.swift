import XCTest
@testable import XBTLightning

final class SpliceTests: XCTestCase {
    private let point = String(repeating: "a", count: 64) + ":0"
    private func estimate(removing: Bool = false) -> Data {
        var data = Data()
        let pairs: [(UInt64, UInt64)] = [(1, 500), (3, 2), (4, 20_000), (11, 120_000), (12, 100_000), (13, 6)]
        for (key, value) in pairs {
            data += ProtoFields.field(key, integer: value)
        }
        if removing { data += ProtoFields.field(14, integer: 1) }
        return data
    }
    func testExplicitAmountAndDirectionNeverUseMaxOrOverrideFeeFloor() throws {
        for direction in ["in", "out"] {
            let data = try RegtestNode.spliceRequest(point: point, direction: direction, sats: 20_000, feeRate: 2,
                                                    address: direction == "out" ? "bcrt1-destination" : "")
            let fields = try ProtoFields(data)
            XCTAssertEqual(fields.integers[2], direction == "out" ? 1 : 0)
            XCTAssertEqual(fields.integers[3], 20_000)
            XCTAssertEqual(fields.integers[5], 2)
            XCTAssertNil(fields.integers[4]); XCTAssertNil(fields.integers[8])
        }
        XCTAssertThrowsError(try RegtestNode.spliceRequest(point: "invalid", direction: "in", sats: 20_000, feeRate: 2, address: ""))
        for amount in [UInt64(0), 545, 1_000_001, UInt64.max] {
            XCTAssertThrowsError(try RegtestNode.spliceRequest(point: point, direction: "in", sats: amount, feeRate: 2, address: ""))
        }
    }
    func testEstimatesRejectRefusalsNegativeAmountsAndForeignDestinations() throws {
        let e = try SpliceEstimate.decode(estimate(), sats: 20_000, feeRate: 2, removing: false)
        XCTAssertEqual(e.fee, 500); XCTAssertEqual(e.lockDepth, 6)
        XCTAssertThrowsError(try SpliceEstimate.decode(estimate(), sats: 20_000, feeRate: 2, removing: true))
        XCTAssertThrowsError(try SpliceEstimate.decode(estimate() + ProtoFields.field(15, data: Data("peer_unsupported".utf8)), sats: 20_000, feeRate: 2, removing: false))
        XCTAssertThrowsError(try SpliceEstimate.decode(estimate() + ProtoFields.field(1, integer: UInt64.max), sats: 20_000, feeRate: 2, removing: false))
        XCTAssertThrowsError(try SpliceEstimate.decode(estimate(), sats: 30_000, feeRate: 2, removing: false))
        XCTAssertFalse(SpliceChannelState.permits("unknown-future-state"))
    }
    func testNewPendingSpliceNeverDisplaysThePreviousTransaction() throws {
        let last = ProtoFields.field(4, data: Data("old-tx".utf8)) + ProtoFields.field(6, data: Data("locked".utf8))
        let pending = ProtoFields.field(2, data: Data("negotiating".utf8))
        let row = ProtoFields.field(1002, data: Data("pending".utf8)) +
            ProtoFields.field(1003, data: pending) + ProtoFields.field(1004, data: last)
        let snapshot = try SpliceChannelState.decode(ProtoFields(row))
        XCTAssertEqual(snapshot.progress, "negotiating")
        XCTAssertEqual(snapshot.txid, "")
    }

    func testReviewsAreSingleUseAndExpireBeforeAnyExecution() throws {
        let now = Date()
        let e = try SpliceEstimate.decode(estimate(), sats: 20_000, feeRate: 2, removing: false)
        var book = SpliceReviews()
        let item = SpliceReview(token: "token", point: point, direction: "in", address: "", estimate: e, request: Data(), created: now)
        book.save(item)
        XCTAssertEqual(try book.consume("token", now: now).point, point)
        XCTAssertThrowsError(try book.consume("token", now: now))
        book.save(item)
        XCTAssertThrowsError(try book.consume("token", now: now.addingTimeInterval(120)))
        XCTAssertThrowsError(try book.consume("token", now: now))
    }
}
