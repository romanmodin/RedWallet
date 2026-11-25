import Foundation
import XCTest
@testable import XBTLightning

final class ChannelStatusTests: XCTestCase {
    private func string(_ field: UInt64, _ value: String) -> Data {
        ProtoFields.field(field, data: Data(value.utf8))
    }

    private func open(_ point: String, active: Bool) -> Data {
        let row = string(2, "peer") + string(3, point) +
            ProtoFields.field(1, integer: active ? 1 : 0) + ProtoFields.field(6, integer: 80_000) +
            ProtoFields.field(7, integer: 18_000)
        return ProtoFields.field(11, data: row)
    }

    private func pending(_ point: String, field: UInt64, remaining: UInt64? = nil) -> Data {
        var row = string(1, "peer") + string(2, point) + ProtoFields.field(4, integer: 90_000)
        if field == 2 { row += ProtoFields.field(5, integer: 8_000) }
        var wrapper = ProtoFields.field(1, data: row)
        if let remaining { wrapper += ProtoFields.field(7, integer: remaining) }
        return ProtoFields.field(field, data: wrapper)
    }

    func testOpenAndPendingStatesUseTheirDistinctWireFields() throws {
        let result = try LightningChannelStatus.decode(
            open: open("active:0", active: true) + open("inactive:0", active: false),
            pending: pending("pending:0", field: 2, remaining: 2) +
                pending("closing:0", field: 5) + pending("force:0", field: 4))
        XCTAssertEqual(result.count, 5)
        let rows = Dictionary(uniqueKeysWithValues: result.map { ($0.point, $0) })
        XCTAssertEqual(rows["active:0"]?.state, "active")
        XCTAssertEqual(rows["active:0"]?.localSats, 80_000)
        XCTAssertEqual(rows["active:0"]?.remoteSats, 18_000)
        XCTAssertEqual(rows["inactive:0"]?.remoteSats, 18_000)
        XCTAssertEqual(rows["pending:0"]?.remoteSats, 8_000)
        XCTAssertEqual(rows["closing:0"]?.remoteSats, 0)
        XCTAssertNil(rows["force:0"]?.remoteSats)
        XCTAssertEqual(rows["inactive:0"]?.state, "inactive")
        XCTAssertEqual(rows["pending:0"]?.state, "pending")
        XCTAssertEqual(rows["pending:0"]?.localSats, 90_000)
        XCTAssertEqual(rows["pending:0"]?.confirmationsRemaining, 2)
        XCTAssertEqual(rows["closing:0"]?.state, "closing")
        XCTAssertEqual(rows["force:0"]?.state, "forceClosing")
    }

    func testNegotiatedPaymentLimitsUseThePhonePerspective() throws {
        let send = ProtoFields.field(4, integer: 99_000_001) + ProtoFields.field(5, integer: 500)
        let receive = ProtoFields.field(4, integer: 801_000_000)
        let row = string(2, "peer") + string(3, "one:0") +
            ProtoFields.field(29, data: send) + ProtoFields.field(30, data: receive)
        let bytes = ProtoFields.field(11, data: row) + open("old:0", active: false)
        let channels = try LightningChannelStatus.decode(open: bytes, pending: Data())
        let channel = try XCTUnwrap(channels.first { $0.point == "one:0" })
        XCTAssertEqual(channel.sendLimits, ["maxPendingMsat": "99000001", "minPartMsat": "500"])
        XCTAssertEqual(channel.receiveLimits, ["maxPendingMsat": "801000000", "minPartMsat": "0"])
        let old = try XCTUnwrap(channels.first { $0.point == "old:0" })
        XCTAssertNil(old.sendLimits)
        XCTAssertNil(old.receiveLimits)
    }

    func testOpeningReceiveLimitsPreserveDefaultsAndLeaveFundingHeadroom() throws {
        let defaults = try ProtoFields(RegtestNode.openReceiveConstraints(minSats: nil, maxSats: nil, fundingSats: 100_000))
        XCTAssertEqual(defaults.integers[15], LightningAmounts.maxSats * 1_000)
        XCTAssertNil(defaults.integers[9])
        let custom = try ProtoFields(RegtestNode.openReceiveConstraints(minSats: 23, maxSats: 800_000, fundingSats: 100_000))
        XCTAssertEqual(custom.integers[9], 23_000)
        XCTAssertEqual(custom.integers[15], 800_000_000)
        XCTAssertThrowsError(try RegtestNode.openReceiveConstraints(minSats: 100, maxSats: 99, fundingSats: 100_000))
        XCTAssertThrowsError(try RegtestNode.openReceiveConstraints(minSats: nil, maxSats: UInt64.max, fundingSats: 100_000))
        XCTAssertThrowsError(try RegtestNode.openReceiveConstraints(minSats: 0, maxSats: nil, fundingSats: 100_000))
        XCTAssertThrowsError(try RegtestNode.openReceiveConstraints(minSats: nil, maxSats: 0, fundingSats: 100_000))
        XCTAssertThrowsError(try RegtestNode.openReceiveConstraints(minSats: 100_000, maxSats: nil, fundingSats: 100_000))
        XCTAssertThrowsError(try RegtestNode.openReceiveConstraints(minSats: 100_001, maxSats: nil, fundingSats: 100_000))
    }

    func testTransitionsCountEachOutpointOnceAndClosingTakesPrecedence() throws {
        let opened = try LightningChannelStatus.decode(
            open: open("same:0", active: true), pending: pending("same:0", field: 2))
        XCTAssertEqual(opened.count, 1)
        XCTAssertEqual(opened.first?.state, "active")
        let closing = try LightningChannelStatus.decode(
            open: open("same:0", active: true),
            pending: pending("same:0", field: 2) + pending("same:0", field: 5) + pending("same:0", field: 4))
        XCTAssertEqual(closing.count, 1)
        XCTAssertEqual(closing.first?.state, "forceClosing")
    }

    func testUnknownConfirmationCountIsNotInventedAndMalformedDataFails() throws {
        let result = try LightningChannelStatus.decode(open: Data(), pending: pending("waiting:0", field: 2))
        XCTAssertNil(result.first?.confirmationsRemaining)
        XCTAssertThrowsError(try LightningChannelStatus.decode(open: Data(), pending: ProtoFields.field(2, data: Data())))
        XCTAssertTrue(try LightningChannelStatus.decode(open: Data(), pending: Data()).isEmpty)
    }

    func testPeerMetadataIsMatchedByIdentityAndOfflineChannelsRemainVisible() throws {
        let row = string(2, "peer") + string(3, "one:0") + string(34, "Example")
        let peers = ProtoFields.field(1, data: string(1, "other") + string(3, "wrong:9735")) +
            ProtoFields.field(1, data: string(1, "peer") + string(3, "example.onion:9735"))
        let opened = ProtoFields.field(11, data: row) + open("two:0", active: true)
        let result = try LightningChannelStatus.decode(open: opened, pending: Data(), peers: peers)
        XCTAssertEqual(result.first?.peerAlias, "Example")
        XCTAssertTrue(result.allSatisfy { $0.peerAddress == "example.onion:9735" })
        let offline = try LightningChannelStatus.decode(open: opened, pending: Data())
        XCTAssertEqual(offline.count, 2)
        XCTAssertTrue(offline.allSatisfy { $0.peerAddress == nil })
        XCTAssertEqual(offline.first?.peer, "peer")
    }
}
