#if XBT_LND_TOR_SMOKE
import XCTest
import Lndmobile
@testable import XBTLightning

final class TorSmokeTests: XCTestCase {
    func testTorPublicSyncOnionPeerAndFeeFailureWithoutDirectFallback() async throws {
        guard #available(iOS 17.0, *) else { throw XCTSkip("Tor requires iOS 17") }
        try await RegtestNode.shared.selectTransport("tor")
        print("Tor smoke: starting the node")
        try await RegtestNode.shared.startSelectedMainnet(peer: "")
        print("Tor smoke: observing initial wallet state")
        for _ in 0..<120 {
            let state = try await RegtestNode.shared.status()
            if state == "Needs setup" || state == "Locked" {
                print("Tor smoke: setting up or unlocking the wallet")
                try await RegtestNode.shared.setupOrUnlock()
                print("Tor smoke: wallet setup or unlock returned")
                break
            }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        print("Tor smoke: observing node readiness")
        var running = false
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(1800))
        var attempt = 0
        while clock.now < deadline {
            do {
                if try await RegtestNode.shared.status() == "Running" { running = true; break }
            } catch NodeFailure.timedOut {
                // During a fresh Tor header/filter sync, the read-only RPC can
                // be busy for its 60s limit. Keep observing within the existing
                // startup budget; never retry a connection or spending action.
                print("Startup status RPC busy; observing actual readiness again")
            }
            if attempt % 12 == 0 { print(await RegtestNode.shared.syncProgress()) }
            attempt += 1
            try await Task.sleep(nanoseconds: 5_000_000_000)
        }
        XCTAssertTrue(running, "Tor XBT sync did not complete; no funds were used")
        guard running else { return }
        print("Tor smoke: connecting to the onion peer")
        try await RegtestNode.shared.connect(to: "0222d36d7b634ead665c982145f6e4507ad65c4f369902ab3ca11e379d2139dc60@eu2pntt4zzsvm2fkcn5uaqxac2mj5t2fk5ecwyhhejp3deu7env2h2ad.onion:9735")
        print("Tor smoke: reading connected peers")
        let peers = try ProtoFields(await rpc { LndmobileListPeers(Data(), $0) })
        let peerKeys = try (peers.bytes[1] ?? []).map { try ProtoFields($0).string(1) }
        XCTAssertTrue(peerKeys.contains("0222d36d7b634ead665c982145f6e4507ad65c4f369902ab3ca11e379d2139dc60"), "The onion peer must appear in LND's connected-peer list")
        print("Tor smoke: checking fees through Tor")
        let connection = try await LightningTor.shared.start()
        let feeURL = try XCTUnwrap(URL(string: connection.feeURL))
        let (fees, response) = try await URLSession.shared.data(from: feeURL)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertNotNil((try JSONSerialization.jsonObject(with: fees) as? [String: Any])?["fee_by_block_target"])
        print("Tor smoke: checking fee failure after Tor stops")
        ArtiRuntime.stop()
        for _ in 0..<30 where ArtiRuntime.state() != 0 { try await Task.sleep(nanoseconds: 200_000_000) }
        let (_, unavailable) = try await URLSession.shared.data(from: feeURL)
        XCTAssertEqual((unavailable as? HTTPURLResponse)?.statusCode, 503, "Tor loss must not fall back to direct fee retrieval")
        print("Tor smoke: checking transport recovery")
        let restored = try await LightningTor.shared.start()
        XCTAssertEqual(restored.port, connection.port, "LND must keep the same SOCKS endpoint after recovery")
        XCTAssertEqual(restored.feeURL, connection.feeURL, "LND must keep the same local fee endpoint after recovery")
        let (_, recovered) = try await URLSession.shared.data(from: feeURL)
        XCTAssertEqual((recovered as? HTTPURLResponse)?.statusCode, 200)
    }
}
#endif
