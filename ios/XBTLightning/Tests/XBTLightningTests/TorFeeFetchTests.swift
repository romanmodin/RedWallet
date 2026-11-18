import XCTest
@testable import XBTLightning

final class TorFeeFetchTests: XCTestCase {
    private let queue = DispatchQueue(label: "tor-fee-fetch-tests")
    private let data = Data("{}".utf8)
    private var policy: TorFeeFetch.Policy {
        var p = TorFeeFetch.Policy()
        p.budget = 0.3; p.retryDelay = 0.01; p.minimumAttempt = 0.01
        return p
    }

    func testTransientFailureThenSuccess() async {
        let done = expectation(description: "recovered")
        var calls = 0
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { true }, transport: { timeout, reply in
            calls += 1
            XCTAssertGreaterThan(timeout, 0)
            XCTAssertLessThanOrEqual(timeout, 0.3)
            reply(calls == 1 ? .failure(URLError(.cannotConnectToHost)) : .success(self.data))
            return {}
        }, completion: { result in
            XCTAssertEqual(try? result.get(), self.data); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
        queue.sync { XCTAssertEqual(calls, 2) }
    }

    func testSlowFirstResponseKeepsItsCircuit() async {
        let done = expectation(description: "slow first response")
        var calls = 0
        let fetch = TorFeeFetch(queue: queue, ready: { true }, transport: { timeout, reply in
            calls += 1
            // Model a circuit whose first response needs three seconds. A two-
            // second per-attempt timeout would repeatedly abandon this work.
            self.queue.asyncAfter(deadline: .now() + min(timeout, 3)) {
                reply(timeout < 3 ? .failure(URLError(.timedOut)) : .success(self.data))
            }
            return {}
        }, completion: { result in
            XCTAssertEqual(try? result.get(), self.data); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 5)
        queue.sync { XCTAssertEqual(calls, 1) }
    }

    func testObservedSOCKSRefusalRetriesThenSucceeds() async {
        let done = expectation(description: "SOCKS recovery")
        var calls = 0
        let stream: [String: Any] = [
            "_kCFStreamErrorDomainKey": NSNumber(value: 1),
            "_kCFStreamErrorCodeKey": NSNumber(value: 22)
        ]
        var info = stream
        info[NSUnderlyingErrorKey] = NSError(domain: "kCFErrorDomainCFNetwork", code: -1000, userInfo: stream)
        let refusal = NSError(domain: NSURLErrorDomain, code: -1000, userInfo: info)
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { true }, transport: { _, reply in
            calls += 1
            reply(calls == 1 ? .failure(refusal) : .success(self.data))
            return {}
        }, completion: { result in
            XCTAssertEqual(try? result.get(), self.data); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
        queue.sync { XCTAssertEqual(calls, 2) }
    }

    func testUnrelatedBadURLErrorsRemainNonRetryable() {
        XCTAssertFalse(TorFeeFetch.retryable(URLError(.badURL)))
        for stream in [
            ["_kCFStreamErrorDomainKey": 1, "_kCFStreamErrorCodeKey": 21],
            ["_kCFStreamErrorDomainKey": 3, "_kCFStreamErrorCodeKey": 22],
            ["_kCFStreamErrorCodeKey": 22],
            ["_kCFStreamErrorDomainKey": 1]
        ] {
            XCTAssertFalse(TorFeeFetch.retryable(
                NSError(domain: NSURLErrorDomain, code: -1000, userInfo: stream)))
        }
        XCTAssertFalse(TorFeeFetch.retryable(NSError(domain: NSURLErrorDomain,
            code: URLError.serverCertificateUntrusted.rawValue,
            userInfo: ["_kCFStreamErrorDomainKey": 1, "_kCFStreamErrorCodeKey": 22])))
    }

    func testStoppedTorDoesNotStartTransport() async {
        let done = expectation(description: "stopped")
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { false }, transport: { _, _ in
            XCTFail("Stopped Tor must not fetch"); return {}
        }, completion: { result in
            XCTAssertNil(try? result.get()); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
    }

    func testNonTransientFailuresDoNotRetry() async {
        for error in [URLError(.timedOut) as Error, URLError(.serverCertificateUntrusted) as Error,
                      URLError(.cancelled) as Error, NSError(domain: "invalid-fee-response", code: 1)] {
            let done = expectation(description: "failure")
            var calls = 0
            let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { true }, transport: { _, reply in
                calls += 1; reply(.failure(error)); return {}
            }, completion: { result in
                XCTAssertNil(try? result.get()); done.fulfill()
            })
            fetch.start()
            await fulfillment(of: [done], timeout: 2)
            queue.sync { XCTAssertEqual(calls, 1) }
        }
    }

    func testRetryExhaustion() async {
        let done = expectation(description: "exhausted")
        var calls = 0
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { true }, transport: { _, reply in
            calls += 1; reply(.failure(URLError(.networkConnectionLost))); return {}
        }, completion: { result in
            XCTAssertNil(try? result.get()); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
        queue.sync { XCTAssertEqual(calls, 3) }
    }

    func testDeadlineDoesNotWaitForTransportCancellation() async {
        let done = expectation(description: "deadline")
        let late = expectation(description: "late callback")
        var p = policy; p.budget = 0.03
        var cancelled = false
        var completions = 0
        var lateSent = false
        let fetch = TorFeeFetch(queue: queue, policy: p, ready: { true }, transport: { _, reply in
            self.queue.asyncAfter(deadline: .now() + 0.15) {
                lateSent = true; reply(.success(self.data)); late.fulfill()
            }
            // Deliberately does not suppress the late callback.
            return { cancelled = true }
        }, completion: { result in
            completions += 1
            XCTAssertEqual((result.failure as? URLError)?.code, .timedOut)
            XCTAssertTrue(cancelled)
            XCTAssertFalse(lateSent, "Deadline must deliver before a cancellation-ignoring transport")
            done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
        await fulfillment(of: [late], timeout: 2)
        queue.sync { XCTAssertEqual(completions, 1) }
    }

    func testCancelStopsPendingTransportAndLateSuccess() async {
        let started = expectation(description: "started")
        let done = expectation(description: "cancelled")
        var callback: TorFeeFetch.Completion?
        var cancelled = false
        var completions = 0
        var lateSent = false
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { true }, transport: { _, reply in
            callback = reply; started.fulfill()
            return { cancelled = true }
        }, completion: { result in
            completions += 1
            XCTAssertEqual((result.failure as? URLError)?.code, .cancelled)
            XCTAssertTrue(cancelled); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [started], timeout: 2)
        fetch.cancel()
        await fulfillment(of: [done], timeout: 2)
        queue.sync { callback?(.success(data)) }
        queue.sync { XCTAssertEqual(completions, 1) }
    }

    func testTorStopsBeforeSuccessfulReply() async {
        let done = expectation(description: "stopped before reply")
        var ready = true
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { ready }, transport: { _, reply in
            ready = false; reply(.success(self.data)); return {}
        }, completion: { result in
            XCTAssertNil(try? result.get()); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
    }

    func testDuplicateCallbackDoesNotScheduleExtraRetry() async {
        let done = expectation(description: "single recovery")
        var calls = 0
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { true }, transport: { _, reply in
            calls += 1
            if calls == 1 {
                reply(.failure(URLError(.cannotConnectToHost)))
                reply(.failure(URLError(.cannotConnectToHost)))
            } else { reply(.success(self.data)) }
            return {}
        }, completion: { result in
            XCTAssertEqual(try? result.get(), self.data); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
        queue.sync { XCTAssertEqual(calls, 2) }
    }

    func testInsufficientRemainingBudgetDoesNotRetry() async {
        let done = expectation(description: "no room to retry")
        var p = policy; p.minimumAttempt = 1
        var calls = 0
        let fetch = TorFeeFetch(queue: queue, policy: p, ready: { true }, transport: { _, reply in
            calls += 1; reply(.failure(URLError(.cannotConnectToHost))); return {}
        }, completion: { result in
            XCTAssertNil(try? result.get()); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
        queue.sync { XCTAssertEqual(calls, 1) }
    }
}

private extension Result {
    var failure: Failure? {
        if case .failure(let error) = self { return error }
        return nil
    }
}
