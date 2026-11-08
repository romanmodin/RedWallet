import XCTest
@testable import XBTLightning

final class MainnetConfigurationTests: XCTestCase {
    func testPeerSelectionPersistsAndCorruptionDoesNotFallBack() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("peer.json")
        XCTAssertEqual(try MainnetPeerStore.load(at: file), "")
        try MainnetPeerStore.save("192.168.1.5:8333", at: file)
        XCTAssertEqual(try MainnetPeerStore.load(at: file), "192.168.1.5:8333")
        try MainnetPeerStore.save("", at: file)
        XCTAssertEqual(try MainnetPeerStore.load(at: file), "")
        try Data("invalid-json".utf8).write(to: file)
        XCTAssertThrowsError(try MainnetPeerStore.load(at: file))
        XCTAssertThrowsError(try MainnetPeerStore.save("host:8333\nbitcoin.regtest=true", at: file))
    }

    func testRecoveryFilesAreBoundToTheirNetwork() throws {
        let material = RecoveryFile.Material(words: Array(repeating: Data("fixture".utf8), count: 24), channelBackup: Data([1, 2, 3]))
        let password = "fixture-passphrase-only"
        let publicFile = try RecoveryFile.seal(material, phrase: password, mainnet: true)
        XCTAssertEqual(try RecoveryFile.open(publicFile, phrase: password, mainnet: true).words, material.words)
        XCTAssertThrowsError(try RecoveryFile.open(publicFile, phrase: password))
        let testFile = try RecoveryFile.seal(material, phrase: password)
        XCTAssertThrowsError(try RecoveryFile.open(testFile, phrase: password, mainnet: true))
    }

    func testPublicChainConfiguration() throws {
        let config = try MainnetConfiguration.text()
        XCTAssertTrue(config.contains("bitcoin.mainnet=true"))
        XCTAssertTrue(config.contains("nobootstrap=true"))
        XCTAssertTrue(config.contains("protocol.wumbo-channels=true"))
        XCTAssertTrue(config.contains("maxchansize=2100000000000000"))
        XCTAssertFalse(config.contains("regtest"))
        XCTAssertFalse(config.contains("127.0.0.1"))
        XCTAssertFalse(config.contains("activation-height=150"))
        for peer in MainnetConfiguration.defaultPeers {
            XCTAssertTrue(config.contains("neutrino.connect=" + peer))
        }
    }
    func testCustomNodeAndInjectionRejection() throws {
        XCTAssertTrue(try MainnetConfiguration.text(peers: ["192.168.1.5:8333"]).contains("neutrino.connect=192.168.1.5:8333"))
        for value in ["host:0", "host:65536", "https://host:8333", "host:8333\nbitcoin.regtest=true", "host.onion:8333", "-host:8333", "host..com:8333"] {
            XCTAssertThrowsError(try MainnetConfiguration.endpoint(value))
        }
        XCTAssertThrowsError(try MainnetConfiguration.text(peers: []))
    }
}
