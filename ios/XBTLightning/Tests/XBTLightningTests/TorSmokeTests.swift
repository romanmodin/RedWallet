#if XBT_LND_TOR_SMOKE
import XCTest
@testable import XBTLightning

final class TorSmokeTests: XCTestCase {
    func testTorPublicSyncOnionPeerAndFeeFailureWithoutDirectFallback() async throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("Tor requires iOS 17") }
        try await RegtestNode.shared.selectTransport("tor")
        try await RegtestNode.shared.startSelectedMainnet(peer: "")
        for _ in 0..<120 {
            let state = try await RegtestNode.shared.status()
            if state == "Needs setup" || state == "Locked" { try await RegtestNode.shared.setupOrUnlock(); break }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        var running = false
        for attempt in 0..<360 {
            if try await RegtestNode.shared.status() == "Running" { running = true; break }
            if attempt % 12 == 0 { print(await RegtestNode.shared.syncProgress()) }
            try await Task.sleep(nanoseconds: 5_000_000_000)
        }
        XCTAssertTrue(running, "Tor XBT sync did not complete; no funds were used")
        guard running else { return }
        try await RegtestNode.shared.connect(to: "0222d36d7b634ead665c982145f6e4507ad65c4f369902ab3ca11e379d2139dc60@eu2pntt4zzsvm2fkcn5uaqxac2mj5t2fk5ecwyhhejp3deu7env2h2ad.onion:9735")
        let connection = try await LightningTor.shared.start()
        let feeURL = try XCTUnwrap(URL(string: connection.feeURL))
        let (fees, response) = try await URLSession.shared.data(from: feeURL)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertNotNil((try JSONSerialization.jsonObject(with: fees) as? [String: Any])?["fee_by_block_target"])
        ArtiRuntime.stop()
        for _ in 0..<30 where ArtiRuntime.state() != 0 { try await Task.sleep(nanoseconds: 200_000_000) }
        let (_, unavailable) = try await URLSession.shared.data(from: feeURL)
        XCTAssertEqual((unavailable as? HTTPURLResponse)?.statusCode, 503, "Tor loss must not fall back to direct fee retrieval")
    }
}
#endif
