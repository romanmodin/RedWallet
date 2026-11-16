import XCTest
import UIKit
@testable import XBTLightning

@MainActor
final class LightningBackgroundTimeTests: XCTestCase {
    func testOnlyRunningNodeRequestsOneBoundedLeasePerCycle() {
        var starts = 0
        var ends: [UIBackgroundTaskIdentifier] = []
        var timeout: (() -> Void)?
        let service = LightningBackgroundTime(begin: { _ in
            starts += 1
            return UIBackgroundTaskIdentifier(rawValue: starts)
        }, end: { ends.append($0) }, schedule: { seconds, action in
            XCTAssertEqual(seconds, 25)
            timeout = action
            return {}
        }, observeLifecycle: false)
        service.leavingForeground()
        XCTAssertEqual(starts, 0)
        service.setNodeRunning(true)
        service.leavingForeground()
        service.leavingForeground()
        XCTAssertEqual(starts, 1)
        timeout?()
        service.leavingForeground()
        XCTAssertEqual(starts, 1, "Never renew an exhausted background budget")
        XCTAssertEqual(ends.count, 1)
        service.enteredForeground()
        service.leavingForeground()
        XCTAssertEqual(starts, 2)
        service.setNodeRunning(false)
        XCTAssertEqual(ends.count, 2)
    }

    func testExpirationAndStaleCallbacksEndExactlyOnce() async {
        var expirations: [() -> Void] = []
        var timers: [() -> Void] = []
        var ends = 0
        let service = LightningBackgroundTime(begin: { expiration in
            expirations.append(expiration)
            return UIBackgroundTaskIdentifier(rawValue: expirations.count)
        }, end: { _ in ends += 1 }, schedule: { _, action in
            timers.append(action)
            return {}
        }, observeLifecycle: false)
        service.setNodeRunning(true)
        service.leavingForeground()
        service.enteredForeground()
        service.leavingForeground()
        expirations[0]()
        timers[0]()
        await Task.yield()
        XCTAssertEqual(ends, 1, "An old callback must not end the new assertion")
        expirations[1]()
        await Task.yield()
        timers[1]()
        XCTAssertEqual(ends, 2)
        service.enteredForeground()
        XCTAssertEqual(ends, 2)
    }

    func testDenialDoesNotEndInvalidIdentifierOrRetry() {
        var starts = 0
        let service = LightningBackgroundTime(begin: { _ in starts += 1; return .invalid },
            end: { _ in XCTFail("Denied assertions must not be ended") },
            schedule: { _, _ in XCTFail("Denied assertions need no timer"); return {} },
            observeLifecycle: false)
        service.setNodeRunning(true)
        service.leavingForeground()
        service.leavingForeground()
        service.enteredForeground()
        XCTAssertEqual(starts, 1)
    }
