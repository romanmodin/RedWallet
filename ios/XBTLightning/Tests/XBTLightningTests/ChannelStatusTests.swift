import Foundation
import XCTest
@testable import XBTLightning

final class ChannelStatusTests: XCTestCase {
    private func string(_ field: UInt64, _ value: String) -> Data {
        ProtoFields.field(field, data: Data(value.utf8))
    }

    private func open(_ point: String, active: Bool) -> Data {
        let row = string(2, "peer") + string(3, point) +
            ProtoFields.field(1, integer: active ? 1 : 0) + ProtoFields.field(6, integer: 80_000)
        return ProtoFields.field(11, data: row)
    }

    private func pending(_ point: String, field: UInt64, remaining: UInt64? = nil) -> Data {
        let row = string(1, "peer") + string(2, point) + ProtoFields.field(4, integer: 90_000)
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
        XCTAssertEqual(rows["inactive:0"]?.state, "inactive")
        XCTAssertEqual(rows["pending:0"]?.state, "pending")
        XCTAssertEqual(rows["pending:0"]?.localSats, 90_000)
        XCTAssertEqual(rows["pending:0"]?.confirmationsRemaining, 2)
        XCTAssertEqual(rows["closing:0"]?.state, "closing")
        XCTAssertEqual(rows["force:0"]?.state, "forceClosing")
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
