import Foundation

// Public bridge API only. No wallet credentials, shared cookies, redirects or caches.
// Default URLSession trust handling performs normal HTTPS certificate validation.
public final class BridgeHTTPTransport: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    public static let shared = BridgeHTTPTransport()
    static let limit = 32768
    private struct Pending {
        let id: String
        let url: URL
        let task: URLSessionDataTask
        let completion: (Result<[String: Any], Error>) -> Void
        var response: HTTPURLResponse?
        var data = Data()
    }
    private let lock = NSLock()
    private var requests: [Int: Pending] = [:]
    private var session: URLSession!

    static func configuration() -> URLSessionConfiguration {
        let config = URLSessionConfiguration.ephemeral
        config.httpCookieStorage = nil
        config.httpShouldSetCookies = false
        config.urlCredentialStorage = nil
        config.urlCache = nil
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 15
        return config
    }
    // The configuration override is internal for offline URLProtocol tests only.
    init(configuration: URLSessionConfiguration = BridgeHTTPTransport.configuration()) {
        super.init()
        let queue = OperationQueue()
        queue.maxConcurrentOperationCount = 1
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: queue)
    }
    static func request(url value: String, method: String, body: String) throws -> URLRequest {
        let paperclipAPI = "https://lightning.paperclip-xbt.xyz/bridge/api/"
        let paperclip = value.hasPrefix(paperclipAPI)
        let api = paperclip ? paperclipAPI : "https://bridge.kilombino.com/api/"
        guard value.utf8.count <= 256, body.utf8.count <= 16384,
              value.hasPrefix(api), let url = URL(string: value) else { throw NodeFailure.invalidReply }
        // Match the original URL suffix so escaped paths and extra query items cannot change the destination.
        let endpoint = String(value.dropFirst(api.count))
        let isQuote = endpoint == "quote"
        if method == "GET" {
            let info = paperclip ? "info?direction=toSHA256" : "info"
            let swap = endpoint.range(of: #"^swap/[0-9a-f]{64}\?t=([0-9a-f]{32})?$"#, options: .regularExpression)
            guard body.isEmpty, endpoint == info || endpoint == "pow" || swap == (endpoint.startIndex..<endpoint.endIndex) else {
                throw NodeFailure.invalidReply
            }
        } else {
            guard method == "POST", isQuote || (paperclip && endpoint == "check"),
                  let fields = try JSONSerialization.jsonObject(with: Data(body.utf8)) as? [String: Any],
                  let invoice = fields["invoice"] as? String, invoice.hasPrefix("lnbc"), invoice.utf8.count <= 8192 else {
                throw NodeFailure.invalidReply
            }
            var keys: Set<String> = ["invoice"]
            if paperclip {
                keys.insert("direction")
                guard (fields["direction"] as? String) == "toSHA256" else { throw NodeFailure.invalidReply }
            }
            if isQuote {
                keys.insert("pow")
                guard let pow = fields["pow"] as? [String: String], Set(pow.keys) == Set(["challenge", "nonce"]),
                      let challenge = pow["challenge"], !challenge.isEmpty, challenge.count <= 200,
                      let nonce = pow["nonce"], nonce.range(of: "^[0-9a-z]{1,32}$", options: .regularExpression) != nil else {
                    throw NodeFailure.invalidReply
                }
            }
            guard Set(fields.keys) == keys else { throw NodeFailure.invalidReply }
        }
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        request.httpMethod = method
        request.httpShouldHandleCookies = false
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("RedWallet", forHTTPHeaderField: "User-Agent")
        if method == "POST" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(body.utf8)
        }
        return request
    }
    public func request(id: String, url: String, method: String, body: String,
                        completion: @escaping (Result<[String: Any], Error>) -> Void) {
        do {
            guard !id.isEmpty, id.utf8.count <= 80 else { throw NodeFailure.invalidReply }
            let request = try Self.request(url: url, method: method, body: body)
            let task = session.dataTask(with: request)
            lock.lock()
            guard requests.count < 4, !requests.values.contains(where: { $0.id == id }) else {
                lock.unlock(); task.cancel(); throw NodeFailure.invalidReply
            }
            requests[task.taskIdentifier] = Pending(id: id, url: request.url!, task: task, completion: completion)
            lock.unlock()
            task.resume()
        } catch { completion(.failure(error)) }
    }
    func invalidate() { session.invalidateAndCancel() }

    public func cancel(id: String) {
        lock.lock()
        let task = requests.values.first(where: { $0.id == id })?.task
        lock.unlock()
        task?.cancel()
    }
    private func finish(_ task: URLSessionTask, error: Error? = nil) {
        lock.lock()
        let pending = requests.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
        guard let pending else { return }
        if let error { task.cancel(); pending.completion(.failure(error)); return }
        guard let response = pending.response, let body = String(data: pending.data, encoding: .utf8) else {
            pending.completion(.failure(NodeFailure.invalidReply)); return
        }
        pending.completion(.success(["status": response.statusCode, "url": pending.url.absoluteString, "body": body]))
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                           newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                           completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        lock.lock()
        let pending = requests[dataTask.taskIdentifier]
        let valid = response is HTTPURLResponse && response.url == pending?.url && response.expectedContentLength <= Int64(Self.limit)
        if valid { requests[dataTask.taskIdentifier]?.response = response as? HTTPURLResponse }
        lock.unlock()
        completionHandler(valid ? .allow : .cancel)
        if !valid { finish(dataTask, error: NodeFailure.invalidReply) }
    }
    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        lock.lock()
        let count = requests[dataTask.taskIdentifier]?.data.count
        let valid = count != nil && data.count <= Self.limit - count!
        if valid { requests[dataTask.taskIdentifier]?.data.append(data) }
        lock.unlock()
        if !valid { finish(dataTask, error: NodeFailure.invalidReply) }
    }
    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        finish(task, error: error)
    }
}
