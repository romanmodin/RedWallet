import Foundation

// Queue-confined, read-only retries. The deadline delivers independently of
// transport cancellation, which may complete asynchronously.
final class TorFeeFetch {
    typealias Completion = (Result<Data, Error>) -> Void
    typealias Cancel = () -> Void
    typealias Transport = (TimeInterval, @escaping Completion) -> Cancel

    struct Policy {
        // Pinned LND WebAPIResponseTimeout is 10s. Leave time for loopback IO.
        var budget: TimeInterval = 8
        var attemptTimeout: TimeInterval = 2
        var retryDelay: TimeInterval = 0.5
        var minimumAttempt: TimeInterval = 1
        var attempts = 3
    }

    private let queue: DispatchQueue
    private let ready: () -> Bool
    private let transport: Transport
    private let completion: Completion
    private let policy: Policy
    private var deadline: DispatchTime?
    private var deadlineWork: DispatchWorkItem?
    private var retryWork: DispatchWorkItem?
    private var cancelTransport: Cancel?
    private var generation = 0
    private var finished = false
    private var count = 0

    init(queue: DispatchQueue, policy: Policy = Policy(), ready: @escaping () -> Bool,
         transport: @escaping Transport, completion: @escaping Completion) {
        self.queue = queue
        self.policy = policy
        self.ready = ready
        self.transport = transport
        self.completion = completion
    }

    func start() {
        queue.async {
            guard !self.finished, self.deadline == nil else { return }
            self.deadline = .now() + self.policy.budget
            let work = DispatchWorkItem { [weak self] in self?.finish(.failure(URLError(.timedOut))) }
            self.deadlineWork = work
            self.queue.asyncAfter(deadline: self.deadline!, execute: work)
            self.attempt()
        }
    }

    func cancel() {
        queue.async { self.finish(.failure(URLError(.cancelled))) }
    }

    private var remaining: TimeInterval {
        let now = DispatchTime.now()
        guard let deadline, deadline > now else { return 0 }
        return Double(deadline.uptimeNanoseconds - now.uptimeNanoseconds) / 1_000_000_000
    }

    private func attempt() {
        guard !finished else { return }
        guard ready() else { finish(.failure(URLError(.notConnectedToInternet))); return }
        let time = remaining
        guard time > 0 else { finish(.failure(URLError(.timedOut))); return }
        count += 1
        generation += 1
        let current = generation
        cancelTransport = transport(min(policy.attemptTimeout, time)) { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard !self.finished, self.generation == current else { return }
                // Invalidate duplicate callbacks before a retry is scheduled.
                self.generation += 1
                self.cancelTransport = nil
                guard self.remaining > 0 else { self.finish(.failure(URLError(.timedOut))); return }
                switch result {
                case .success:
                    guard self.ready() else { self.finish(.failure(URLError(.notConnectedToInternet))); return }
                    self.finish(result)
                case .failure(let error):
                    guard Self.retryable(error), self.ready(), self.count < self.policy.attempts,
                          self.remaining > self.policy.retryDelay + self.policy.minimumAttempt else {
                        self.finish(result); return
                    }
                    let work = DispatchWorkItem { [weak self] in self?.attempt() }
                    self.retryWork = work
                    self.queue.asyncAfter(deadline: .now() + self.policy.retryDelay, execute: work)
                }
            }
        }
    }

    private func finish(_ result: Result<Data, Error>) {
        guard !finished else { return }
        finished = true
        deadlineWork?.cancel(); deadlineWork = nil
        retryWork?.cancel(); retryWork = nil
        let cancel = cancelTransport
        cancelTransport = nil
        cancel?()
        completion(result)
    }

    static func retryable(_ error: Error) -> Bool {
        let error = error as NSError
        guard error.domain == NSURLErrorDomain else { return false }
        return [URLError.timedOut, .cannotFindHost, .cannotConnectToHost,
                .networkConnectionLost, .dnsLookupFailed, .notConnectedToInternet]
            .contains { $0.rawValue == error.code }
    }
}
