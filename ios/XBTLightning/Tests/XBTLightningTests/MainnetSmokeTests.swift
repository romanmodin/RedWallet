#if XBT_LND_PUBLIC_SMOKE
import XCTest
@testable import XBTLightning

// Disposable simulator identity; no funding, channels, or payments.
final class MainnetSmokeTests: XCTestCase {
    func testPublicXBTNodeSyncsWithoutHomeServer() async throws {
        _ = try await RegtestNode.shared.saveNodeName("RedWallet CI")
        try await RegtestNode.shared.startSelectedMainnet(peer: "")
        let selection = try await RegtestNode.shared.savedMainnetPeer()
        XCTAssertEqual(selection, "")
        for _ in 0..<120 {
            let state = try await RegtestNode.shared.status()
            if state == "Needs setup" || state == "Locked" {
                try await RegtestNode.shared.setupOrUnlock()
                break
            }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        var ready = false
        for attempt in 0..<540 {
            if try await RegtestNode.shared.status() == "Running" { ready = true; break }
            if attempt % 6 == 0 { print(await RegtestNode.shared.syncProgress()) }
            try await Task.sleep(nanoseconds: 5_000_000_000)
        }
        XCTAssertTrue(ready, "Public XBT sync did not finish; no funds were used")
        guard ready else { return }
        let before = try ProtoFields(await XBTLightningNode.info())
        XCTAssertEqual(try before.string(2), "RedWallet CI")
        let nameState = try await RegtestNode.shared.saveNodeName("RedWallet CI renamed")
        XCTAssertEqual(nameState["restartRequired"] as? Bool, true)
        let after = try ProtoFields(await XBTLightningNode.info())
        XCTAssertEqual(try after.string(1), try before.string(1))
        XCTAssertEqual(try after.string(2), "RedWallet CI")
        _ = try await RegtestNode.shared.saveNodeName("RedWallet CI")
        let detail = try await RegtestNode.shared.details()
        XCTAssertTrue(detail.contains("Synced: yes"))
        let address = try await RegtestNode.shared.fundingAddress()
        XCTAssertTrue(address.hasPrefix("bc1"))
        let invoice = try await RegtestNode.shared.receive(sats: 100)
        let decoded = try await RegtestNode.shared.decode(invoice)
        XCTAssertEqual(decoded.sats, 100)
    }
}
#endif
