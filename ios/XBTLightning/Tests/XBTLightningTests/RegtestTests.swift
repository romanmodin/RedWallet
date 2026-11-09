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

    private func peer(_ operation: String, _ value: String = "") async throws -> String {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:18149/" + operation)!)
        request.httpMethod = "POST"
        request.httpBody = Data(value.utf8)
        request.timeoutInterval = 100
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let result = String(data: data, encoding: .utf8) else { throw NodeFailure.invalidReply }
        return result
    }

    private func waitUntil(_ check: () async throws -> Bool) async throws {
        for _ in 0..<90 {
            if try await check() { return }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        throw NodeFailure.timedOut
    }

    // A confirmed balance may arrive before Neutrino's sync flag catches up.
    // Observe the fixture's actual tip and LND readiness before each next step;
    // do not retry any spending operation or weaken the production sync guard.
    private func waitForFixtureSync(_ stage: String) async throws {
        print("Fixture stage: " + stage)
        let tipText = try await peer("height")
        let tip = try XCTUnwrap(UInt64(tipText))
        try await waitUntil {
            let info = try ProtoFields(await XBTLightningNode.info())
            return info.integers[6] == tip && info.integers[9] == 1
        }
    }

    func testEmbeddedNodeStartsAndReportsWalletState() async throws {
        try await RegtestNode.shared.start()
        try await RegtestNode.shared.start()
        var status = try await RegtestNode.shared.status()
        for _ in 0..<60 where status == "Starting" {
            try await Task.sleep(nanoseconds: 500_000_000)
            status = try await RegtestNode.shared.status()
        }
        _ = try XCTUnwrap(status == "Needs setup" ? status : nil, "Expected initial wallet setup, got " + status)
        try await RegtestNode.shared.setupOrUnlock()
        var running = false
        for _ in 0..<60 {
            if try await RegtestNode.shared.status() == "Running" { running = true; break }
            try await Task.sleep(nanoseconds: 1_000_000_000)
        }
        XCTAssertTrue(running)
        #if XBT_LND_ROUTED_TEST
        try await waitForFixtureSync("initial wallet ready")
        #endif
        let invoice = try await RegtestNode.shared.receive(sats: 1234)
        let decoded = try await RegtestNode.shared.decode(invoice)
        XCTAssertEqual(decoded.sats, 1234)
        XCTAssertEqual(decoded.hash.count, 64)
        let largeInvoice = try await RegtestNode.shared.receive(sats: 44_000_000)
        let largeDecoded = try await RegtestNode.shared.decode(largeInvoice)
        XCTAssertEqual(largeDecoded.sats, 44_000_000)
        try await RegtestNode.shared.cancelInvoice(hash: largeDecoded.hash)
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
        let sameFunding = try await RegtestNode.shared.fundingAddress()
        XCTAssertEqual(sameFunding, funding, "Repeated requests must retain the unused receiving address")
        #if XBT_LND_ROUTED_TEST
        let peerKey = try await peer("peer")
        let towerURI = try await peer("tower")
        try await RegtestNode.shared.addWatchtower(towerURI)
        let registeredTowers = try await RegtestNode.shared.watchtowers()
        XCTAssertEqual(registeredTowers.count, 1)
        XCTAssertEqual(registeredTowers[0].acknowledged, 0)
        _ = try await peer("fund-large", funding)
        try await waitUntil {
            let funds = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) })
            return (funds.integers[2] ?? 0) >= 100_000
        }
        let nextFunding = try await RegtestNode.shared.fundingAddress()
        XCTAssertNotEqual(nextFunding, funding, "A detected deposit must advance the receiving address")
        let sameNextFunding = try await RegtestNode.shared.fundingAddress()
        XCTAssertEqual(sameNextFunding, nextFunding)
        try await RegtestNode.shared.connect(to: peerKey + "@127.0.0.1:19735")
        try await waitForFixtureSync("funding confirmed; opening channel")
        var point = try await RegtestNode.shared.openChannel(to: peerKey, sats: 10_000_000, feeRate: 125)
        let opening = try await RegtestNode.shared.channelStatus()
        XCTAssertEqual(opening.first(where: { $0.point == point })?.state, "pending")
        _ = try await peer("confirm", point)
        try await waitForFixtureSync("channel funding confirmed")
        try await waitUntil { try ProtoFields(await XBTLightningNode.info()).integers[4] == 1 }

        let opened = try await RegtestNode.shared.channelStatus()
        XCTAssertEqual(opened.filter { $0.point == point }.count, 1)
        XCTAssertEqual(opened.first(where: { $0.point == point })?.state, "active")
        let outgoing = try await peer("invoice-large")
        let review = try await RegtestNode.shared.decode(outgoing)
        XCTAssertEqual(review.sats, 2_000_000)
        try await waitUntil {
            do {
                let request = ProtoFields.field(1, data: Data(peerKey.utf8)) +
                    ProtoFields.field(2, integer: 2_000_000)
                let routes = try ProtoFields(await rpc { LndmobileQueryRoutes(request, $0) })
                return !(routes.bytes[1] ?? []).isEmpty
            } catch { return false }
        }
        do {
            _ = try await RegtestNode.shared.pay(invoice: outgoing, expectedHash: review.hash,
                                                expectedSats: review.sats + 1, feeLimit: 250)
            XCTFail("A changed review must fail before submission")
        } catch let failure as PaymentSubmissionFailure {
            XCTAssertEqual(failure, .invalidReview)
        }
        let settled = try await RegtestNode.shared.pay(invoice: outgoing, expectedHash: review.hash, expectedSats: review.sats, feeLimit: 250)
        XCTAssertTrue(settled)
        // Re-entering the same settled invoice must not create another payment.
        // LND can reject it or return its existing outcome; its persistent payment
        // database must still contain exactly one record for this invoice hash.
        _ = try? await RegtestNode.shared.pay(invoice: outgoing, expectedHash: review.hash,
                                             expectedSats: review.sats, feeLimit: 250)
        let repeatedPage = try await RegtestNode.shared.walletActivity("payments", offset: 0)
        let repeatedRows = repeatedPage["rows"] as? [[String: Any]] ?? []
        XCTAssertEqual(repeatedRows.filter { $0["id"] as? String == review.hash }.count, 1)
        XCTAssertEqual(repeatedRows.first { $0["id"] as? String == review.hash }?["state"] as? String, "settled")
        let incoming = try await RegtestNode.shared.receive(sats: 1_500_000)
        let receipt = try await peer("pay", incoming)
        XCTAssertEqual(receipt, "settled")
        let overview = try await RegtestNode.shared.walletOverview()
        XCTAssertEqual(overview["synced"] as? Bool, true)
        XCTAssertEqual(overview["activeChannels"] as? String, "1")
        let outgoingPage = try await RegtestNode.shared.walletActivity("payments", offset: 0)
        let outgoingRows = outgoingPage["rows"] as? [[String: Any]] ?? []
        XCTAssertTrue(outgoingRows.contains { $0["id"] as? String == review.hash && $0["state"] as? String == "settled" && $0["sats"] as? String == "2000000" })
        let receivedHash = try await RegtestNode.shared.decode(incoming).hash
        let incomingPage = try await RegtestNode.shared.walletActivity("invoices", offset: 0)
        let incomingRows = incomingPage["rows"] as? [[String: Any]] ?? []
        XCTAssertTrue(incomingRows.contains { $0["id"] as? String == receivedHash && $0["state"] as? String == "settled" && $0["sats"] as? String == "1500000" })
        let fundingPage = try await RegtestNode.shared.walletActivity("funding", offset: 0)
        let fundingRows = fundingPage["rows"] as? [[String: Any]] ?? []
        XCTAssertTrue(fundingRows.contains { $0["direction"] as? String == "received" && ($0["confirmations"] as? Int64 ?? 0) > 0 })
        try await waitUntil {
            let towers = try await RegtestNode.shared.watchtowers()
            return towers.contains { $0.acknowledged > 0 && $0.pending == 0 }
        }
        for direction in ["in", "out"] {
            try await waitForFixtureSync("review splice " + direction)
            let mempoolBefore = try await peer("mempool")
            let resize = try await RegtestNode.shared.reviewSplice(point: point, direction: direction, sats: direction == "in" ? 44_000_000 : 2_000_000, feeRate: 125)
            let mempoolAfter = try await peer("mempool")
            XCTAssertEqual(mempoolAfter, mempoolBefore, "Review must not broadcast or lease/spend funds")
            _ = try await RegtestNode.shared.splice(token: resize.token)
            do { _ = try await RegtestNode.shared.splice(token: resize.token); XCTFail("A splice token must be consumed once") } catch { }
            try await waitUntil {
                let rows = try await RegtestNode.shared.channelStatus()
                return rows.contains {
                    $0.point == point && !($0.splice?.txid ?? "").isEmpty &&
                        $0.splice?.txid != point.split(separator: ":").first.map(String.init)
                }
            }
            let resizing = try await RegtestNode.shared.channelStatus()
            let txid = try XCTUnwrap(resizing.first(where: { $0.point == point })?.splice?.txid)
            XCTAssertNotEqual(txid, point.split(separator: ":").first.map(String.init), "A new resize must not confirm the previous funding transaction")
            print("Fixture stage: confirming new splice " + direction + " · " + txid)
            _ = try await peer("confirm-splice", txid + ":" + String(resize.estimate.lockDepth + 2))
            try await waitForFixtureSync("splice confirmed " + direction)
            try await waitUntil {
                let rows = try await RegtestNode.shared.channelStatus()
                return rows.contains { $0.peer == peerKey && $0.state == "active" && $0.point != point && $0.splice?.progress == "locked" }
            }
            let resized = try await RegtestNode.shared.channelStatus()
            point = try XCTUnwrap(resized.first(where: { $0.peer == peerKey && $0.state == "active" })?.point)
            let raw = try ProtoFields(await rpc { LndmobileListChannels(Data(), $0) })
            let channel = try XCTUnwrap(raw.bytes[11]?.first)
            XCTAssertEqual(try ProtoFields(channel).integers[5], resize.estimate.capacity)
            let syncedBackup = try await RegtestNode.shared.channelBackup()
            XCTAssertFalse(syncedBackup.isEmpty)
        }
        let fundedBackup = try await RegtestNode.shared.channelBackup()
        XCTAssertGreaterThan(fundedBackup.count, backup.count)
        #endif
        let documents = try XCTUnwrap(FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first)
        let recovery = try await RegtestNode.shared.recoveryFile(phrase: "disposable-restore-fixture")
        try recovery.write(to: documents.appendingPathComponent("RestoreFixture.rwln"), options: .atomic)
        let identity = try ProtoFields(await XBTLightningNode.info()).string(1)
        try identity.write(to: documents.appendingPathComponent("RestoreIdentity.txt"), atomically: true, encoding: .utf8)
        #if XBT_LND_ROUTED_TEST
        try await waitForFixtureSync("payments settled; closing channel")
        let beforeClose = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) }).integers[2] ?? 0
        // The isolated bitcoind-backed LND peer uses the fork's fixed regtest
        // estimate of 50 sat/vB. A 1 sat/vB request cannot negotiate with it
        // within the wallet's reviewed three-times fee ceiling.
        let closing = try await RegtestNode.shared.closeChannel(point: point, feeRate: 50)
        XCTAssertEqual(closing.count, 64)
        _ = try await peer("confirm", closing + ":0")
        try await waitForFixtureSync("cooperative close confirmed")
        try await waitUntil {
            let funds = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) })
            return (funds.integers[2] ?? 0) > beforeClose
        }
        let target = try await peer("withdraw-address")
        let withdrawal = try await RegtestNode.shared.reviewWithdrawal(address: target, sats: 2_000_000, feeRate: 125)
        let txid = try await RegtestNode.shared.withdraw(token: withdrawal.token)
        XCTAssertEqual(txid.count, 64)
        do {
            _ = try await RegtestNode.shared.withdraw(token: withdrawal.token)
            XCTFail("A consumed withdrawal review must not submit again")
        } catch { }
        let delivered = try await peer("verify-withdraw-large", txid)
        XCTAssertEqual(delivered, "received-2000000")
        try await waitForFixtureSync("withdrawal confirmed")
        try await waitUntil {
            let transactions = try ProtoFields(await rpc { LndmobileGetTransactions(Data(), $0) })
            return try (transactions.bytes[1] ?? []).contains {
                let tx = try ProtoFields($0)
                return try tx.string(1) == txid && (tx.integers[3] ?? 0) > 0
            }
        }
        let chainHistory = try await RegtestNode.shared.onchainHistory()
        XCTAssertTrue(chainHistory.contains(txid))
        let remaining = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) }).integers[2] ?? 0
        XCTAssertGreaterThan(remaining, 100_000)
        try String(remaining).write(to: documents.appendingPathComponent("RestoreBalance.txt"), atomically: true, encoding: .utf8)
        #endif
        _ = try await rpc { LndmobileStopDaemon(Data(), $0) }
    }

    // A separately signed, empty app container receives only this portable
    // backup and the public identity used for comparison.
    func testRestoresIdentityFromPortableFile() async throws {
        let bundle = Bundle(for: RegtestTests.self)
        let file = try XCTUnwrap(bundle.url(forResource: "RestoreFixture", withExtension: "rwln"))
        let expected = try String(contentsOf: XCTUnwrap(bundle.url(forResource: "RestoreIdentity", withExtension: "txt")), encoding: .utf8)
        try await RegtestNode.shared.start()
        try await waitUntil { try await RegtestNode.shared.status() == "Needs setup" }
        try await RegtestNode.shared.restore(file: Data(contentsOf: file), phrase: "disposable-restore-fixture")
        try await waitUntil { try await RegtestNode.shared.status() == "Running" }
        let info = try ProtoFields(await XBTLightningNode.info())
        XCTAssertEqual(try info.string(1), expected)
        #if XBT_LND_ROUTED_TEST
        try await waitForFixtureSync("portable wallet restored")
        // The original daemon is stopped. A different signed app has only the
        // portable backup: prove discovery AND spending of recovered on-chain
        // funds, rather than accepting the same public identity as recovery.
        let expectedBalance = try XCTUnwrap(UInt64(String(contentsOf:
            XCTUnwrap(bundle.url(forResource: "RestoreBalance", withExtension: "txt")), encoding: .utf8)))
        try await waitUntil {
            let balance = try ProtoFields(await rpc { LndmobileWalletBalance(Data(), $0) })
            return (balance.integers[2] ?? 0) == expectedBalance
        }
        let target = try await peer("withdraw-address")
        let review = try await RegtestNode.shared.reviewWithdrawal(address: target, sats: 2_000_000, feeRate: 125)
        let txid = try await RegtestNode.shared.withdraw(token: review.token)
        let received = try await peer("verify-withdraw-large", txid)
        XCTAssertEqual(received, "received-2000000")
        #endif
        _ = try await rpc { LndmobileStopDaemon(Data(), $0) }
    }

}
