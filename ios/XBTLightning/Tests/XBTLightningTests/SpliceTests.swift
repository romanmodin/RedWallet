import XCTest
@testable import XBTLightning

final class SpliceTests: XCTestCase {
    private let point = String(repeating: "a", count: 64) + ":0"
    func testOpeningAboveTenMillionIsRejectedBeforeAnyNodeCall() async {
        do {
            _ = try await RegtestNode.shared.openChannel(to: "02" + String(repeating: "a", count: 64), sats: 10_000_001)
            XCTFail("Opening above the requested cap must not reach LND")
        } catch NodeFailure.channelOpeningLimit {
            // The cap is enforced natively even when called without the React form.
        } catch { XCTFail("Expected the opening cap error, got \(error)") }
    }
    func testFeeRatesProtectSignedBackendProductsAtMaximumTransactionWeight() {
        let rate = LightningAmounts.maxFeeRate
        XCTAssertTrue(LightningAmounts.validFeeRate(rate))
        XCTAssertTrue(LightningAmounts.validFeeRate(1_000_000))
        XCTAssertFalse(LightningAmounts.validFeeRate(rate + 1))
        XCTAssertFalse(LightningAmounts.validFeeRate(3_002_399_751_580_330))
        let product = (rate * 3000).multipliedReportingOverflow(by: 1_000_000)
        XCTAssertFalse(product.overflow)
        XCTAssertLessThanOrEqual(product.partialValue + 999, UInt64(Int64.max))
        let weightProduct = (rate * 3000 / 4).multipliedReportingOverflow(by: 4_000_000)
        XCTAssertFalse(weightProduct.overflow)
        XCTAssertLessThanOrEqual(weightProduct.partialValue + 999, UInt64(Int64.max))
    }
    func testUnsafeOpeningFeeIsRejectedBeforeAnyNodeCall() async {
        do {
            _ = try await RegtestNode.shared.openChannel(to: "02" + String(repeating: "a", count: 64), sats: 100_000,
                                                       feeRate: LightningAmounts.maxFeeRate + 1)
            XCTFail("Unsafe fee must not reach LND")
        } catch NodeFailure.invalidAmount {
            // Local validation must run before the readiness RPC.
        } catch { XCTFail("Expected the fee validation error, got \(error)") }
    }
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
        for amount in [UInt64(0), LightningAmounts.maxSats + 1, UInt64.max] {
            XCTAssertThrowsError(try RegtestNode.spliceRequest(point: point, direction: "in", sats: amount, feeRate: 2, address: ""))
        }
    }
    func testLargeResizeKeepsExactAmountAndFeeAndNeverEnablesUseMax() throws {
        for direction in ["in", "out"] {
            let request = try RegtestNode.spliceRequest(point: point, direction: direction, sats: 44_000_000,
                                                       feeRate: 250, address: direction == "out" ? "bcrt1-own" : "")
            let fields = try ProtoFields(request)
            XCTAssertEqual(fields.integers[3], 44_000_000)
            XCTAssertEqual(fields.integers[5], 250)
            XCTAssertNil(fields.integers[4])
        }
        for rate in [UInt64(0), LightningAmounts.maxFeeRate + 1, UInt64.max] {
            XCTAssertThrowsError(try RegtestNode.spliceRequest(point: point, direction: "in", sats: 44_000_000, feeRate: rate, address: ""))
        }
        XCTAssertFalse(LightningAmounts.valid(UInt64.max))
        XCTAssertFalse(LightningAmounts.valid(0))
        XCTAssertTrue(LightningAmounts.valid(0, allowZero: true))
        XCTAssertLessThanOrEqual(LightningAmounts.maxSats * 1000, UInt64(Int64.max))
        XCTAssertLessThanOrEqual(LightningAmounts.maxFeeRate * 3000, UInt64(Int64.max))
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

    func testNewSubmissionCannotReuseThePreviousLockedSnapshotBeforePendingAppears() throws {
        let last = ProtoFields.field(4, data: Data("old-tx".utf8)) + ProtoFields.field(6, data: Data("locked".utf8))
        let old = ProtoFields.field(1002, data: Data("ok".utf8)) + ProtoFields.field(1004, data: last)
        let channel = ProtoFields.field(2, data: Data("peer".utf8)) + ProtoFields.field(3, data: Data(point.utf8)) + old
        let open = ProtoFields.field(11, data: channel)
        let waiting = try XCTUnwrap(LightningChannelStatus.decode(open: open, pending: Data(), awaitingSplices: [point]).first?.splice)
        XCTAssertEqual(waiting.txid, "")
        XCTAssertEqual(waiting.progress, "awaiting_update")
        XCTAssertFalse(SpliceChannelState.permits(waiting.status))
        let completed = try XCTUnwrap(LightningChannelStatus.decode(open: open, pending: Data()).first?.splice)
        XCTAssertEqual(completed.txid, "old-tx")
        XCTAssertEqual(completed.progress, "locked")
        let pending = ProtoFields.field(2, data: Data("broadcast".utf8)) + ProtoFields.field(8, data: Data("new-tx".utf8))
        let current = try SpliceChannelState.decode(ProtoFields(old + ProtoFields.field(1003, data: pending)), awaitingNewAttempt: true)
        XCTAssertEqual(current.txid, "new-tx")
        XCTAssertEqual(current.progress, "broadcast")
    }

    func testProto3OptionalFieldsDefaultEmptyWithoutWeakeningRequiredIdentifiers() throws {
        let empty = try ProtoFields(Data())
        XCTAssertEqual(try empty.optionalString(15), "")
        XCTAssertThrowsError(try empty.string(1))
        let malformed = try ProtoFields(ProtoFields.field(15, data: Data([0xff])))
        XCTAssertThrowsError(try malformed.optionalString(15))
        let unsupported = try SpliceChannelState.decode(empty)
        XCTAssertEqual(unsupported.status, "")
        XCTAssertFalse(SpliceChannelState.permits(unsupported.status))
        XCTAssertEqual(unsupported.txid, "")
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
    func testPeerLocksAndMeasuredConfirmationsAreIndependent() throws {
        let pending = ProtoFields.field(2, data: Data("confirmed".utf8)) +
            ProtoFields.field(8, data: Data("new-tx".utf8)) +
            ProtoFields.field(11, integer: 6) + ProtoFields.field(12, integer: 1)
        let state = try SpliceChannelState.decode(ProtoFields(ProtoFields.field(1003, data: pending)))
        XCTAssertEqual(state.confirmations, 0)
        XCTAssertEqual(state.weLocked, true)
        XCTAssertEqual(state.peerLocked, false)
        XCTAssertNil(state.onchainConfirmations)
        let transactions = ProtoFields.field(1, data: ProtoFields.field(1, data: Data("old-tx".utf8)) + ProtoFields.field(3, integer: 63)) +
            ProtoFields.field(1, data: ProtoFields.field(1, data: Data("new-tx".utf8)) + ProtoFields.field(3, integer: 12))
        let measured = try SpliceChannelState.transactionConfirmations(transactions)
        XCTAssertEqual(measured["new-tx"], 12)
        XCTAssertNil(measured["unrelated"])
        let reorg = ProtoFields.field(1, data: ProtoFields.field(1, data: Data("new-tx".utf8)))
        XCTAssertEqual(try SpliceChannelState.transactionConfirmations(reorg)["new-tx"], 0)
    }

    func testAvailableLiquidityExcludesOfflineChannelsReservesAndFunderFeeBuffer() throws {
        let constraints = ProtoFields.field(2, integer: 1_000)
        let active = ProtoFields.field(1, integer: 1) + ProtoFields.field(6, integer: 10_000) +
            ProtoFields.field(8, integer: 500) + ProtoFields.field(18, integer: 1) +
            ProtoFields.field(29, data: constraints)
        let offline = ProtoFields.field(6, integer: 50_000)
        XCTAssertEqual(try LightningLiquidity.available(
            ProtoFields.field(11, data: active) + ProtoFields.field(11, data: offline)), 8_000)
    }

}
