import XCTest
@testable import XBTLightning

final class RegtestTests: XCTestCase {
    func testProtobufBounds() throws {
        let message = ProtoFields.field(2, data: Data("test".utf8))
        XCTAssertEqual(try ProtoFields(message).bytes[2], [Data("test".utf8)])
        XCTAssertThrowsError(try ProtoFields(Data([0x12, 0x7f])))
        XCTAssertThrowsError(try ProtoFields(Data(repeating: 0xff, count: 10)))
    }

    func testEmbeddedNodeStartsAndReportsWalletState() async throws {
        try await RegtestNode.shared.start()
        try await RegtestNode.shared.start()
        let status = try await RegtestNode.shared.status()
        XCTAssertEqual(status, "Needs setup")
        try await RegtestNode.shared.setupOrUnlock()
        var running = false
        for _ in 0..<60 {
            if try await RegtestNode.shared.status() == "Running" { running = true; break }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        XCTAssertTrue(running)
        let invoice = try await RegtestNode.shared.receive(sats: 1234)
        let decoded = try await RegtestNode.shared.decode(invoice)
        XCTAssertEqual(decoded.sats, 1234)
        XCTAssertEqual(decoded.hash.count, 64)
        let history = try await RegtestNode.shared.recentPayments()
        XCTAssertEqual(history, "No outgoing test payments.")
        let backup = try await RegtestNode.shared.channelBackup()
        XCTAssertFalse(backup.isEmpty)
    }
}
