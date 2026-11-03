import XCTest
import Lndmobile
@testable import XBTLightning

final class RegtestTests: XCTestCase {
    func testLocalPeerValidation() throws {
        XCTAssertEqual(try RegtestNode.privatePeer("192.168.1.10"), "192.168.1.10")
        for host in ["8.8.8.8", "127.0.0.1:18444", "127.0.0.1\nbitcoin.mainnet=true", "10.0.999.1"] {
            XCTAssertThrowsError(try RegtestNode.privatePeer(host))
        }
    }
    func testProtobufBounds() throws {
        let message = ProtoFields.field(2, data: Data("test".utf8))
        XCTAssertEqual(try ProtoFields(message).bytes[2], [Data("test".utf8)])
        XCTAssertThrowsError(try ProtoFields(Data([0x12, 0x7f])))
        XCTAssertThrowsError(try ProtoFields(Data(repeating: 0xff, count: 10)))
    }

    func testEmbeddedNodeStartsAndReportsWalletState() async throws {
        try await RegtestNode.shared.start()
        try await RegtestNode.shared.start()
        var status = try await RegtestNode.shared.status()
        for _ in 0..<60 where status == "Starting" {
            try await Task.sleep(nanoseconds: 500_000_000)
            status = try await RegtestNode.shared.status()
        }
        try XCTUnwrap(status == "Needs setup" ? status : nil, "Expected initial wallet setup, got " + status)
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
        let sealed = try await RegtestNode.shared.recoveryFile(phrase: "regtest-only-fixture-pass")
        let material = try RecoveryFile.open(sealed, phrase: "regtest-only-fixture-pass")
        XCTAssertEqual(material.words.count, 24)
        XCTAssertFalse(material.channelBackup.isEmpty)
        XCTAssertThrowsError(try RecoveryFile.open(sealed, phrase: "wrong-fixture-password"))
        let summary = try await RegtestNode.shared.details()
        XCTAssertTrue(summary.contains("Node: "))
        let funding = try await RegtestNode.shared.fundingAddress()
        XCTAssertTrue(funding.hasPrefix("bcrt1"))
        _ = try await rpc { LndmobileStopDaemon(Data(), $0) }
    }
}
