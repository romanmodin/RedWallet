import XCTest
@testable import XBTLightning

final class MainnetConfigurationTests: XCTestCase {
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
