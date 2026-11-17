import XCTest
@testable import XBTLightning

final class TorFeeFetchTests: XCTestCase {
    private let queue = DispatchQueue(label: "tor-fee-fetch-tests")
    private let data = Data("{}".utf8)
    private var policy: TorFeeFetch.Policy {
        var p = TorFeeFetch.Policy()
        p.budget = 0.3; p.attemptTimeout = 0.05; p.retryDelay = 0.01; p.minimumAttempt = 0.01
        return p
    }

    func testTransientFailureThenSuccess() async {
        let done = expectation(description: "recovered")
        var calls = 0
        let fetch = TorFeeFetch(queue: queue, policy: policy, ready: { true }, transport: { timeout, reply in
            calls += 1
            XCTAssertGreaterThan(timeout, 0)
            XCTAssertLessThanOrEqual(timeout, 0.05)
            reply(calls == 1 ? .failure(URLError(.cannotConnectToHost)) : .success(self.data))
            return {}
        }, completion: { result in
            XCTAssertEqual(try? result.get(), self.data); done.fulfill()
        })
        fetch.start()
        await fulfillment(of: [done], timeout: 2)
        queue.sync { XCTAssertEqual(calls, 2) }
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
        for error in [URLError(.serverCertificateUntrusted) as Error,
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
            calls += 1; reply(.failure(URLError(.timedOut))); return {}
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
