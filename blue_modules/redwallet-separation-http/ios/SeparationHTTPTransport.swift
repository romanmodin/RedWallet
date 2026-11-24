import Foundation

enum SeparationHTTPFailure: Error { case invalidRequest, invalidReply, unavailable, canceled, timedOut }
struct SeparationHTTPResult { let url: String; let body: String; let serverTime: TimeInterval }

// A dedicated foreground session: no LND, credentials, cookies, caches or generic URL access.
// Server trust uses Apple's default validation. Redirects are refused BEFORE any follow-up.
// https://developer.apple.com/documentation/foundation/urlsessiontaskdelegate
final class SeparationHTTPTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    static let evidenceBase = "https://blockstream.info/api"
    static let anchorBase = "https://mempool.space/api"
    private struct Pending {
        let id: String
        let url: URL
        let limit: Int
        let task: URLSessionDataTask
        let expiresAt: Date
        let uptimeDeadline: TimeInterval
        let deadline: DispatchWorkItem
        let completion: (Result<SeparationHTTPResult, Error>) -> Void
        var accepted = false
        var serverTime: TimeInterval?
        var data = Data()
    }
    private let lock = NSLock()
    private var requests: [Int: Pending] = [:]
    private var invalidated = false
    private var session: URLSession!

    static func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        config.timeoutIntervalForRequest = 8
        config.timeoutIntervalForResource = 8
        config.waitsForConnectivity = false
        return config
    }
    // Internal configuration injection is for offline URLProtocol tests, never exposed to JS.
    init(configuration: URLSessionConfiguration = SeparationHTTPTransport.configuration()) {
        super.init()
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }
    static func bodyLimit(for value: String) throws -> Int {
        guard value.utf8.count <= 256 else { throw SeparationHTTPFailure.invalidRequest }
        let evidence = value.hasPrefix(evidenceBase + "/")
        let base = evidence ? evidenceBase : anchorBase
        guard value.hasPrefix(base + "/") else { throw SeparationHTTPFailure.invalidRequest }
        guard let parts = URLComponents(string: value), let allowed = URLComponents(string: base),
              parts.scheme == allowed.scheme, parts.host == allowed.host, parts.port == allowed.port,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.string == value else { throw SeparationHTTPFailure.invalidRequest }
        let path = String(value.dropFirst(base.count))
        func matches(_ pattern: String) -> Bool {
            guard let range = path.range(of: pattern, options: .regularExpression) else { return false }
            return range == path.startIndex..<path.endIndex
        }
        if path == "/blocks/tip/height" || matches(#"^/block-height/[1-9][0-9]{0,8}$"#)
            || matches(#"^/block/[0-9a-f]{64}$"#) { return 16384 }
        guard evidence else { throw SeparationHTTPFailure.invalidRequest }
        if matches(#"^/block/[0-9a-f]{64}/header$"#) { return 160 }
        if matches(#"^/tx/[0-9a-f]{64}/hex$"#) { return 2_000_000 }
        if matches(#"^/tx/[0-9a-f]{64}/merkle-proof$"#) { return 16384 }
        if matches(#"^/tx/[0-9a-f]{64}/outspend/(0|[1-9][0-9]{0,9})$"#),
           let index = UInt64(path.split(separator: "/").last!), index <= UInt32.max { return 16384 }
        throw SeparationHTTPFailure.invalidRequest
    }
    static func parsedServerTime(_ value: String?) -> TimeInterval? {
        guard let value else { return nil }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "EEE, dd MMM yyyy HH:mm:ss z"
        guard let date = formatter.date(from: value) else { return nil }
        let seconds = date.timeIntervalSince1970
        return seconds >= 0 && seconds <= TimeInterval(UInt32.max) && seconds.rounded(.down) == seconds ? seconds : nil
    }
    static func request(url value: String, limit: Int) throws -> URLRequest {
        let maximum = try bodyLimit(for: value)
        guard limit > 0, limit <= maximum, let url = URL(string: value), url.absoluteString == value else {
            throw SeparationHTTPFailure.invalidRequest
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 8)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("identity", forHTTPHeaderField: "Accept-Encoding")
        request.setValue("RedWallet", forHTTPHeaderField: "User-Agent")
        request.setValue("no-cache, no-store, max-age=0", forHTTPHeaderField: "Cache-Control")
        request.setValue("no-cache", forHTTPHeaderField: "Pragma")
        return request
    }
    func get(id: String, url: String, limit: Int, completion: @escaping (Result<SeparationHTTPResult, Error>) -> Void) {
        do {
            guard !id.isEmpty, id.utf8.count <= 80 else { throw SeparationHTTPFailure.invalidRequest }
            let request = try Self.request(url: url, limit: limit)
            lock.lock()
            guard !invalidated, requests.count < 4, !requests.values.contains(where: { $0.id == id }) else {
                lock.unlock(); throw SeparationHTTPFailure.unavailable
            }
            let task = session.dataTask(with: request)
            let deadline = DispatchWorkItem { [weak self, weak task] in
                guard let task else { return }
                self?.finish(task, error: SeparationHTTPFailure.timedOut)
            }
            requests[task.taskIdentifier] = Pending(id: id, url: request.url!, limit: limit,
                task: task, expiresAt: Date().addingTimeInterval(8), uptimeDeadline: ProcessInfo.processInfo.systemUptime + 8,
                deadline: deadline, completion: completion)
            lock.unlock()
            DispatchQueue.global().asyncAfter(deadline: .now() + 8, execute: deadline)
            task.resume()
        } catch { completion(.failure(error)) }
    }
    func cancel(id: String) {
        lock.lock()
        let task = requests.values.first(where: { $0.id == id })?.task
        lock.unlock()
        if let task { finish(task, error: SeparationHTTPFailure.canceled) }
    }
    func cancelAll() {
        lock.lock()
        let tasks = requests.values.map(\.task)
        lock.unlock()
        for task in tasks { finish(task, error: SeparationHTTPFailure.canceled) }
    }
    func invalidate() {
        lock.lock()
        invalidated = true
        let tasks = requests.values.map(\.task)
        lock.unlock()
        for task in tasks { finish(task, error: SeparationHTTPFailure.canceled) }
        session.invalidateAndCancel()
    }
    private func finish(_ task: URLSessionTask, error: Error? = nil) {
        lock.lock()
        let pending = requests.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let pending else { return }
        pending.deadline.cancel()
        if let error { task.cancel(); pending.completion(.failure(error)); return }
        guard Date() < pending.expiresAt, ProcessInfo.processInfo.systemUptime < pending.uptimeDeadline else {
            pending.completion(.failure(SeparationHTTPFailure.timedOut)); return
        }
        guard pending.accepted, !pending.data.isEmpty, let body = String(data: pending.data, encoding: .utf8), let serverTime = pending.serverTime else {
            pending.completion(.failure(SeparationHTTPFailure.invalidReply)); return
        }
        pending.completion(.success(SeparationHTTPResult(url: pending.url.absoluteString, body: body, serverTime: serverTime)))
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
        finish(task, error: SeparationHTTPFailure.invalidReply)
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didReceive challenge: URLAuthenticationChallenge,
                    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void) {
        completionHandler(challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust
            ? .performDefaultHandling : .cancelAuthenticationChallenge, nil)
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        let pending = requests[dataTask.taskIdentifier]
        let http = response as? HTTPURLResponse
        let serverTime = Self.parsedServerTime(http?.value(forHTTPHeaderField: "Date"))
        var valid = pending != nil && serverTime != nil && http?.statusCode == 200 && http?.url == pending?.url
            && response.expectedContentLength <= Int64(pending?.limit ?? 0)
        if let length = http?.value(forHTTPHeaderField: "Content-Length") {
            valid = valid && !length.isEmpty && length.utf8.allSatisfy { $0 >= 48 && $0 <= 57 }
                && UInt64(length).map { $0 <= UInt64(pending?.limit ?? 0) } == true
        }
        if valid {
            requests[dataTask.taskIdentifier]?.accepted = true
            requests[dataTask.taskIdentifier]?.serverTime = serverTime
        }
        lock.unlock()
        completionHandler(valid ? .allow : .cancel)
        if !valid { finish(dataTask, error: SeparationHTTPFailure.invalidReply) }
    }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let pending = requests[dataTask.taskIdentifier]
        let valid = pending?.accepted == true && data.count <= (pending!.limit - pending!.data.count)
        if valid { requests[dataTask.taskIdentifier]?.data.append(data) }
        lock.unlock()
        if !valid { finish(dataTask, error: SeparationHTTPFailure.invalidReply) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(task, error: error)
    }
}
