import Foundation
import CryptoKit
import XCTest
@testable import XBTLightning

// Synthetic only. Drives the production PaymentResult + Reply adapters (with a short
// injected deadline) and the production PaymentReconciliation fallback.
final class PaymentReconciliationTests: XCTestCase {
    private let preimage = Data(repeating: 0x11, count: 32)
    private var paymentHash: String { Data(SHA256.hash(data: preimage)).map { String(format: "%02x", $0) }.joined() }

    private func row(hash: String? = nil, status: UInt64, proof: Data? = nil) -> Data {
        var data = ProtoFields.field(1, data: Data((hash ?? self.paymentHash).utf8)) + ProtoFields.field(10, integer: status)
        if let proof { data += ProtoFields.field(6, data: Data(proof.map { String(format: "%02x", $0) }.joined().utf8)) }
        return data
    }

    private final class Counter: @unchecked Sendable {
        private let lock = NSLock()
        private var value = 0
        func bump() { lock.lock(); value += 1; lock.unlock() }
        var count: Int { lock.lock(); defer { lock.unlock() }; return value }
    }

    // Real adapters: `rpc` arms the production Reply timer; PaymentResult filters the stream.
    private func send(_ messages: [Data], counter: Counter, timeout: TimeInterval = 0.2) -> () async throws -> Data {
        {
            counter.bump()
            // A real mobile stream retains its callback until completion.
            var activeStream: PaymentResult?
            defer { withExtendedLifetime(activeStream) {} }
            return try await rpc(timeout: timeout) { callback in
                let stream = PaymentResult(callback)
                activeStream = stream
                for message in messages { stream.onResponse(message) }
            }
        }
    }

    func testSilentStreamWithTerminalFailedRowReturnsFalseWithoutResubmitting() async throws {
        let sends = Counter(), lookups = Counter()
        let settled = try await PaymentReconciliation.settled(
            hash: paymentHash, send: send([row(status: 1)], counter: sends),
            lookup: { lookups.bump(); return [self.row(status: 3)] })
        XCTAssertFalse(settled)
        XCTAssertEqual(sends.count, 1)
        XCTAssertEqual(lookups.count, 1)
    }

    func testSilentStreamWithVerifiedSettledRowReturnsTrue() async throws {
        let settled = try await PaymentReconciliation.settled(
            hash: paymentHash, send: send([], counter: Counter()), lookup: { [self.row(status: 2, proof: self.preimage)] })
        XCTAssertTrue(settled)
    }

    func testAmbiguousRecordsKeepPending() async {
        let cases: [[Data]] = [[], [row(status: 1)], [row(status: 4)], [row(status: 0)],
                               [row(status: 3), row(status: 3)], [row(status: 2, proof: Data(repeating: 0x22, count: 32))],
                               [row(status: 2)], [row(hash: String(repeating: "22", count: 32), status: 3)]]
        for rows in cases {
            let sends = Counter()
            do {
                _ = try await PaymentReconciliation.settled(hash: paymentHash, send: send([], counter: sends), lookup: { rows })
                XCTFail("Ambiguous record must not classify")
            } catch NodeFailure.timedOut {
                XCTAssertEqual(sends.count, 1)
            } catch { XCTFail("Unexpected \(error)") }
        }
    }

    func testFailedLookupAndStreamErrorsStayInconclusive() async {
        do {
            _ = try await PaymentReconciliation.settled(hash: paymentHash, send: send([], counter: Counter()),
                                                        lookup: { throw NodeFailure.invalidReply })
            XCTFail()
        } catch NodeFailure.timedOut {} catch { XCTFail("Unexpected \(error)") }
        let lookups = Counter()
        do {
            _ = try await PaymentReconciliation.settled(hash: paymentHash, send: { throw NodeFailure.invalidReply },
                                                        lookup: { lookups.bump(); return [self.row(status: 3)] })
            XCTFail()
        } catch NodeFailure.invalidReply { XCTAssertEqual(lookups.count, 0) } catch { XCTFail("Unexpected \(error)") }
    }

    func testPromptTerminalStreamNeverLooksUp() async throws {
        let lookups = Counter()
        let failed = try await PaymentReconciliation.settled(hash: paymentHash, send: send([row(status: 3)], counter: Counter()),
                                                             lookup: { lookups.bump(); return [] })
        XCTAssertFalse(failed)
        let settled = try await PaymentReconciliation.settled(hash: paymentHash, send: send([row(status: 2, proof: preimage)], counter: Counter()),
                                                              lookup: { lookups.bump(); return [] })
        XCTAssertTrue(settled)
        XCTAssertEqual(lookups.count, 0)
    }
}
