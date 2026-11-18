import XCTest
@testable import XBTLightning

final class LightningStartupTests: XCTestCase {
    func testTimeoutKeepsStateObservationAndBackgroundGraceAvailable() async {
        var failureCount = 0
        let task = Task<Void, Error> { throw NodeFailure.timedOut }
        do {
            try await waitForLightningStartup(task) { failureCount += 1 }
            XCTFail("The caller must still see the timeout")
        } catch NodeFailure.timedOut {
            XCTAssertEqual(failureCount, 0, "A callback timeout must not mark the daemon failed or disable its background lease")
        } catch {
            XCTFail("Wrong startup error")
        }
    }

    func testConfirmedFailureRunsCleanupAndPreservesTheError() async {
        var failureCount = 0
        let task = Task<Void, Error> { throw NodeFailure.invalidReply }
        do {
            try await waitForLightningStartup(task) { failureCount += 1 }
            XCTFail("A real startup failure must propagate")
        } catch NodeFailure.invalidReply {
            XCTAssertEqual(failureCount, 1)
        } catch {
            XCTFail("Wrong startup error")
        }
    }

    func testSuccessfulStartupDoesNotDisarmBackgroundGrace() async throws {
        var failureCount = 0
        try await waitForLightningStartup(Task<Void, Error> {}) { failureCount += 1 }
        XCTAssertEqual(failureCount, 0)
    }
}
