import XCTest
@testable import XBTLightning

final class LightningNodeNameTests: XCTestCase {
    func testDefaultPersistenceAndConfig() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: dir) }
        let file = dir.appendingPathComponent("name.json")
        XCTAssertEqual(try LightningNodeName.load(at: file), "RedWallet")
        try LightningNodeName.save("  XCOM79 Mobile  ", at: file)
        let saved = try LightningNodeName.load(at: file)
        XCTAssertEqual(saved, "XCOM79 Mobile")
        let config = try MainnetConfiguration.text(alias: saved)
        XCTAssertTrue(config.contains("\nalias=XCOM79 Mobile\n"))
        XCTAssertEqual(config, try MainnetConfiguration.text().replacingOccurrences(of: "alias=RedWallet", with: "alias=XCOM79 Mobile"))
        XCTAssertEqual(MainnetConfiguration.directoryName, "XBTLightning-mainnet")
        XCTAssertEqual(MainnetConfiguration.credentialService, "com.redwallet.xbt-lightning.mainnet.v1")
        XCTAssertThrowsError(try LightningNodeName.save("bad\nbitcoin.regtest=true", at: file))
        XCTAssertEqual(try LightningNodeName.load(at: file), saved)
        try Data("broken-json".utf8).write(to: file)
        XCTAssertThrowsError(try LightningNodeName.load(at: file))
        // A corrupt preference can be repaired explicitly without touching the node.
        try LightningNodeName.save("RedWallet", at: file)
        XCTAssertEqual(try LightningNodeName.load(at: file), "RedWallet")
    }

    func testUTF8LimitAndConfigInjection() throws {
        XCTAssertEqual(try LightningNodeName.validate(String(repeating: "a", count: 32)), String(repeating: "a", count: 32))
        XCTAssertEqual(try LightningNodeName.validate(String(repeating: "я", count: 16)), String(repeating: "я", count: 16))
        XCTAssertEqual(try LightningNodeName.validate("XCOM79 ⚡"), "XCOM79 ⚡")
        for bad in ["", "   ", String(repeating: "a", count: 33), String(repeating: "я", count: 17),
                    "a\nb", "a\rb", "a\u{0}b", "a\tb", "a\u{2028}b", "a=b", "a#b", "a;b", "[x]", "\"x\"", "a\\b"] {
            XCTAssertThrowsError(try MainnetConfiguration.text(alias: bad), bad)
        }
    }

    func testPendingNameDoesNotClaimTheRunningNodeChanged() {
        let pending = LightningNodeName.state(saved: "XCOM79 Mobile", active: "RedWallet")
        XCTAssertEqual(pending["active"] as? String, "RedWallet")
        XCTAssertEqual(pending["restartRequired"] as? Bool, true)
        XCTAssertEqual(LightningNodeName.state(saved: "XCOM79 Mobile", active: nil)["restartRequired"] as? Bool, false)
        XCTAssertEqual(LightningNodeName.state(saved: "XCOM79 Mobile", active: "XCOM79 Mobile")["restartRequired"] as? Bool, false)
    }
}
