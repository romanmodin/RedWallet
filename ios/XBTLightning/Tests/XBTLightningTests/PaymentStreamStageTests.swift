import Foundation
import XCTest
import Lndmobile
@testable import XBTLightning

// Synthetic only: no node, wallet data, network or production behavior change.
// The production stream adapters are private, so these tests drive the real
// `rpc`/`Reply` continuation with a sender that applies the same status filter
// (deliver only 2/3, otherwise keep waiting) and records stage markers. The last
// "begin" without a matching "end" names the call that is actually waiting.
final class PaymentStreamStageTests: XCTestCase {
    private let hash = "synthetic-payment-hash"
    private let privatePeer = "private-peer"
    private let privatePreimage = "private-preimage"
    private let invoice = "lnbcrt-synthetic-invoice"

    private func field(_ n: UInt64, _ value: UInt64) -> Data { ProtoFields.field(n, integer: value) }
    private func string(_ n: UInt64, _ value: String) -> Data { ProtoFields.field(n, data: Data(value.utf8)) }
    private func page(_ rows: Data...) -> Data { rows.reduce(Data()) { $0 + ProtoFields.field(1, data: $1) } }

    private func record(status: UInt64, reason: UInt64? = nil, index: UInt64 = 17) -> Data {
        var data = string(1, hash) + field(7, 80_000_000) + field(10, status) + field(15, index)
        if let reason { data += field(16, reason) }
        return data
    }

    private final class Stages: @unchecked Sendable {
        private let lock = NSLock()
        private var entries: [String] = []
        func mark(_ stage: String) {
            lock.lock(); entries.append(stage); lock.unlock()
            print("Synthetic stage: " + stage)
        }
        var all: [String] { lock.lock(); defer { lock.unlock() }; return entries }
        var waiting: String? {
            let begun = all.filter { $0.hasSuffix(" begin") }.map { String($0.dropLast(" begin".count)) }
            return begun.first { !all.contains($0 + " end") }
        }
    }

    private final class Submissions: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        func record() { lock.lock(); value += 1; lock.unlock() }
        var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    }

    // Mirrors PaymentResult/BridgePaymentResult: only status 2 or 3 completes the call.
    private func deliver(_ message: Data, to reply: LndmobileCallbackProtocol) {
        do {
            let status = try ProtoFields(message).integers[10]
            if status == 2 || status == 3 { reply.onResponse(message) }
        } catch { reply.onError(error) }
    }

    // One-shot callback with the same completion contract as `Reply`, but with an
    // injectable deadline so a stalled stream is observable without a 60s wait.
    private final class Callback: NSObject, LndmobileCallbackProtocol, @unchecked Sendable {
        private let lock = NSLock()
        private var continuation: CheckedContinuation<Data, Error>?
        init(_ continuation: CheckedContinuation<Data, Error>, deadline: TimeInterval) {
            self.continuation = continuation
            super.init()
            DispatchQueue.global().asyncAfter(deadline: .now() + deadline) { [weak self] in
                self?.finish(.failure(NodeFailure.timedOut))
            }
        }
        private func finish(_ result: Result<Data, Error>) {
            lock.lock(); let pending = continuation; continuation = nil; lock.unlock()
            pending?.resume(with: result)
        }
        func onResponse(_ response: Data?) { finish(.success(response ?? Data())) }
        func onError(_ error: Error?) { finish(.failure(error ?? NodeFailure.invalidReply)) }
    }

    private func send(_ stages: Stages, _ submissions: Submissions, messages: [Data], streamError: Error? = nil,
                      deadline: TimeInterval = 0.2) async -> Result<Data, Error> {
        stages.mark("SendPaymentV2 begin")
        submissions.record()
        do {
            let data = try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Data, Error>) in
                let callback = Callback(continuation, deadline: deadline)
                for message in messages { deliver(message, to: callback) }
                if let streamError { callback.onError(streamError) }
            }
            stages.mark("SendPaymentV2 end")
            return .success(data)
        } catch let error as NodeFailure where error.isTimeout {
            return .failure(NodeFailure.timedOut) // No "end" marker: this call is the one still waiting.
        } catch {
            stages.mark("SendPaymentV2 end")
            return .failure(error)
        }
    }

    private func lookup(_ stages: Stages, database: Data) throws -> [LightningWalletActivity] {
        stages.mark("ListPayments lookup begin")
        defer { stages.mark("ListPayments lookup end") }
        return try LightningWalletActivity.payments(database)
    }

    private func trace(_ stages: Stages, database: Data, index: UInt64) throws -> String {
        stages.mark("payment trace begin")
        defer { stages.mark("payment trace end") }
        return try LightningPaymentTrace.report(page: database, index: index, hash: hash)
    }

    func testTerminalFailedStreamCompletesOnceAndMatchesTheDatabaseRecord() async throws {
        let stages = Stages(), submissions = Submissions()
        let terminal = record(status: 3, reason: 2)
        // In-flight updates precede the terminal record and must not complete the call.
        let result = await send(stages, submissions, messages: [record(status: 1), record(status: 4), terminal])
        let data = try result.get()
        XCTAssertEqual(try ProtoFields(data).integers[10], 3)
        XCTAssertEqual(try ProtoFields(data).integers[16], 2)
        XCTAssertEqual(submissions.count, 1, "A terminal failure must not resubmit")
        XCTAssertNil(stages.waiting)

        let activity = try XCTUnwrap(lookup(stages, database: page(record(status: 3, reason: 2))).first)
        XCTAssertEqual(activity.state, "failed")
        XCTAssertEqual(activity.failureReasonCode, 2)
        XCTAssertEqual(activity.id, hash)
        XCTAssertEqual(stages.all, ["SendPaymentV2 begin", "SendPaymentV2 end",
                                    "ListPayments lookup begin", "ListPayments lookup end"])
    }

    func testInconclusiveStreamNamesTheSendAsTheWaitingStageAndStaysPending() async throws {
        for status in [UInt64(1), 4, 0, 9] {
            let stages = Stages(), submissions = Submissions()
            let result = await send(stages, submissions, messages: [record(status: status)])
            guard case .failure(let error) = result, (error as? NodeFailure)?.isTimeout == true else {
                return XCTFail("Status \(status) must not complete the stream")
            }
            XCTAssertEqual(stages.waiting, "SendPaymentV2", "The unmatched begin marker identifies the waiting call")
            XCTAssertEqual(submissions.count, 1)
        }
        // A stream-level error is inconclusive: it is neither success nor a recorded failure.
        let stages = Stages(), submissions = Submissions()
        let result = await send(stages, submissions, messages: [], streamError: NSError(domain: "synthetic", code: 1))
        guard case .failure(let error) = result else { return XCTFail("A stream error must surface") }
        XCTAssertFalse(error is PaymentSubmissionFailure)
        XCTAssertEqual(submissions.count, 1)
    }

    func testMalformedStreamMessageSurfacesAnErrorInsteadOfSettling() async throws {
        let stages = Stages(), submissions = Submissions()
        let result = await send(stages, submissions, messages: [Data([0x12, 0x7f])])
        guard case .failure = result else { return XCTFail("Malformed streams must not settle") }
        XCTAssertEqual(submissions.count, 1)
    }

    func testStalledStreamStillResolvesFromTheMatchingTerminalDatabaseRow() async throws {
        let stages = Stages(), submissions = Submissions()
        let result = await send(stages, submissions, messages: [record(status: 1)])
        guard case .failure(let error) = result, (error as? NodeFailure)?.isTimeout == true else {
            return XCTFail("The stalled stream must stay unresolved")
        }
        XCTAssertEqual(stages.waiting, "SendPaymentV2")

        // The explicit lookup reads the same hash as terminally failed and never resubmits.
        let rows = page(record(status: 3, reason: 2))
        let activity = try XCTUnwrap(lookup(stages, database: rows).first)
        XCTAssertEqual(activity.state, "failed")
        XCTAssertEqual(activity.failureReasonCode, 2)
        XCTAssertEqual(submissions.count, 1)
        XCTAssertEqual(stages.waiting, "SendPaymentV2", "Only the send remains unmatched; lookup completed")

        // An in-flight row for the same hash stays pending, and a settled row is only settled.
        XCTAssertEqual(try lookup(Stages(), database: page(record(status: 1))).first?.state, "pending")
        XCTAssertEqual(try lookup(Stages(), database: page(record(status: 2))).first?.state, "settled")
        XCTAssertNil(try lookup(Stages(), database: page(record(status: 1))).first?.failureReasonCode)
    }

    func testTerminalTraceNamesNoRouteAndRedactsIdentifiersRoutesAndSecrets() throws {
        let stages = Stages()
        let route = ProtoFields.field(4, data: string(8, privatePeer))
        let failure = field(1, 15) + field(8, 1)
        let attempt = field(1, 2) + ProtoFields.field(2, data: route) + field(3, 11_000_000) + field(4, 17_000_000) +
            ProtoFields.field(5, data: failure) + string(6, privatePreimage)
        let payment = record(status: 3, reason: 2) + string(5, invoice) + field(13, 10_000_000) +
            ProtoFields.field(14, data: attempt) + string(6, privatePreimage)
        let report = try trace(stages, database: page(payment), index: 17)
        XCTAssertTrue(report.contains("Node status: failed"), report)
        XCTAssertTrue(report.contains("Payment failure: no route"), report)
        for sensitive in [hash, privatePeer, privatePreimage, invoice] {
            XCTAssertFalse(report.contains(sensitive), "Trace leaked synthetic secret: " + sensitive)
        }
        XCTAssertEqual(stages.all, ["payment trace begin", "payment trace end"])
        XCTAssertNil(stages.waiting)

        // A trace for a different index or hash is rejected rather than reported.
        XCTAssertThrowsError(try LightningPaymentTrace.report(page: page(payment), index: 18, hash: hash))
        XCTAssertThrowsError(try LightningPaymentTrace.report(page: page(payment), index: 17, hash: "another"))

        // A terminal failure with no retained attempts is still reported without secrets.
        let bare = try LightningPaymentTrace.report(page: page(record(status: 3, reason: 2)), index: 17, hash: hash)
        XCTAssertTrue(bare.contains("No route attempts retained"), bare)
        XCTAssertFalse(bare.contains(hash))
    }

    func testStageMarkersIdentifyTheLastUnmatchedCall() {
        let stages = Stages()
        stages.mark("SendPaymentV2 begin")
        stages.mark("SendPaymentV2 end")
        stages.mark("ListPayments lookup begin")
        XCTAssertEqual(stages.waiting, "ListPayments lookup")
        stages.mark("ListPayments lookup end")
        stages.mark("payment trace begin")
        XCTAssertEqual(stages.waiting, "payment trace")
        stages.mark("payment trace end")
        XCTAssertNil(stages.waiting)
    }
}

private extension NodeFailure {
    var isTimeout: Bool { if case .timedOut = self { return true } else { return false } }
}
