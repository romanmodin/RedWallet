import XCTest
@testable import XBTLightning

final class LightningTransportTests: XCTestCase {
    func testTorEndpointRequiresTransportAndRejectsInjection() throws {
        let uri = LightningWatchtower.defaultURI
        XCTAssertThrowsError(try LightningWatchtower.parse(uri, usingTor: false))
        let (_, address) = try LightningWatchtower.parse(uri, usingTor: true)
        XCTAssertTrue(address.hasSuffix(".onion:9911"))
        for bad in ["short.onion:9911", String(repeating: "1", count: 56) + ".onion:9911", address + "\nbitcoin.regtest=true"] {
            XCTAssertThrowsError(try MainnetConfiguration.endpoint(bad, usingTor: true))
        }
        XCTAssertThrowsError(try LightningWatchtower.parse("badkey@127.0.0.1:9911", usingTor: true))
    }
    func testTorConfigurationCannotUseDirectFeesOrDirectFallback() throws {
        XCTAssertThrowsError(try MainnetConfiguration.text(torPort: 19050))
        XCTAssertThrowsError(try MainnetConfiguration.text(torPort: 19050, torFeeURL: "https://example.com/fees"))
        let text = try MainnetConfiguration.text(torPort: 19050, torFeeURL: "http://127.0.0.1:19051/fees")
        XCTAssertTrue(text.contains("tor.skip-proxy-for-clearnet-targets=false"))
        XCTAssertTrue(text.contains("tor.socks=127.0.0.1:19050"))
        XCTAssertFalse(text.contains("fee.url=https:"))
        XCTAssertTrue(text.contains("wtclient.active=true"))
    }
    func testSavedNetworkCorruptionDoesNotSelectDirect() throws {
        let file = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: file) }
        XCTAssertEqual(try LightningNetworkStore.load(at: file), .direct)
        try LightningNetworkStore.save(.tor, at: file)
        XCTAssertEqual(try LightningNetworkStore.load(at: file), .tor)
        try Data("bad-config".utf8).write(to: file)
        XCTAssertThrowsError(try LightningNetworkStore.load(at: file))
    }
    func testFeeGatewayDoesNotAcceptArbitraryProxyRequests() {
        XCTAssertTrue(TorFeeService.accepts(Data("GET /fees HTTP/1.1\r\nHost: localhost\r\n\r\n".utf8)))
        for text in ["CONNECT example.com:443 HTTP/1.1\r\n\r\n", "GET https://example.com/fees HTTP/1.1\r\n\r\n", "GET /fees?url=https://evil HTTP/1.1\r\n\r\n", "GET /fees HTTP/1.1\r\n"] {
            XCTAssertFalse(TorFeeService.accepts(Data(text.utf8)))
        }
    }
    func testRegistrationIsNotAcknowledgmentAndModernFieldsAreNotDoubleCounted() throws {
        let key = Data([2] + Array(repeating: UInt8(7), count: 32))
        let identity = ProtoFields.field(1, data: key)
        let empty = try LightningTower.decode(ProtoFields.field(1, data: identity))
        XCTAssertEqual(empty[0].acknowledged, 0)
        XCTAssertEqual(empty[0].sessions, 0)
        let session = ProtoFields.field(1, integer: 7) + ProtoFields.field(2, integer: 2)
        let info = ProtoFields.field(1, integer: 1) + ProtoFields.field(2, integer: 1) + ProtoFields.field(3, data: session)
        let tower = identity + ProtoFields.field(5, data: session) + ProtoFields.field(6, data: info)
        let result = try LightningTower.decode(ProtoFields.field(1, data: tower))
        XCTAssertEqual(result[0].acknowledged, 7)
        XCTAssertEqual(result[0].pending, 2)
        XCTAssertEqual(result[0].sessions, 1)
        XCTAssertTrue(result[0].eligible)
    }
}
