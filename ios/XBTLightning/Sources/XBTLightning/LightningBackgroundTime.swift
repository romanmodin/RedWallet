import Foundation
import UIKit

// One finite grace period for a running node per foreground/background cycle.
// UIKit owns the actual allowance; the timer is a ceiling, never a promise.
// Ending an assertion neither stops LND nor cancels/retries a payment.
@MainActor
public final class LightningBackgroundTime {
    public static let shared = LightningBackgroundTime()
    static let graceSeconds: TimeInterval = 25
    private let begin: (@escaping () -> Void) -> UIBackgroundTaskIdentifier
    private let end: (UIBackgroundTaskIdentifier) -> Void
    private let schedule: (TimeInterval, @escaping () -> Void) -> (() -> Void)
    private var observers: [NSObjectProtocol] = []
    private var identifier: UIBackgroundTaskIdentifier = .invalid
    private var cancelTimer: (() -> Void)?
    private var generation = UUID()
    private var attempted = false
    private var running = false

    init(
        begin: @escaping (@escaping () -> Void) -> UIBackgroundTaskIdentifier = {
            UIApplication.shared.beginBackgroundTask(withName: "Finish Lightning activity", expirationHandler: $0)
        },
        end: @escaping (UIBackgroundTaskIdentifier) -> Void = { UIApplication.shared.endBackgroundTask($0) },
        schedule: @escaping (TimeInterval, @escaping () -> Void) -> (() -> Void) = { seconds, action in
            let item = DispatchWorkItem(block: action)
            DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: item)
            return { item.cancel() }
        },
        observeLifecycle: Bool = true
    ) {
        self.begin = begin
        self.end = end
        self.schedule = schedule
        if observeLifecycle {
            observers.append(NotificationCenter.default.addObserver(
                forName: UIApplication.willResignActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in Task { @MainActor in self?.leavingForeground() } })
            observers.append(NotificationCenter.default.addObserver(
                forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
            ) { [weak self] _ in Task { @MainActor in self?.enteredForeground() } })
        }
    }

    public func setNodeRunning(_ value: Bool) {
        running = value
        if !value { finish() }
    }

    func leavingForeground() {
        guard running, !attempted else { return }
        attempted = true
        let current = UUID()
        generation = current
        identifier = begin { [weak self] in
            Task { @MainActor in
                guard let self, self.generation == current else { return }
                self.finish()
            }
        }
        guard identifier != .invalid else { return }
        cancelTimer = schedule(Self.graceSeconds) { [weak self] in
            guard let self, self.generation == current else { return }
            self.finish()
        }
    }

    func enteredForeground() {
        finish()
        attempted = false
    }

    private func finish() {
        generation = UUID()
        cancelTimer?()
        cancelTimer = nil
        let previous = identifier
        identifier = .invalid
        if previous != .invalid { end(previous) }
    }
}
