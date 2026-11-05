import Foundation
import Network

// The only upstream is the existing XBT fee feed. This is not a general HTTP proxy.
// iOS 17's documented proxy API explicitly disables direct failover.
final class TorFeeService: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    private let proxyPort: UInt16
    private let queue = DispatchQueue(label: "com.redwallet.lightning.tor-fees")
    private var listener: NWListener?
    private var port: UInt16?
    private var assignedPort: UInt16?
    private var clients = 0
    private lazy var session: URLSession? = {
        guard #available(iOS 17.0, *) else { return nil }
        let configuration = URLSessionConfiguration.ephemeral
        var proxy = ProxyConfiguration(socksv5Proxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: proxyPort)!))
        proxy.allowFailover = false
        configuration.proxyConfigurations = [proxy]
        configuration.timeoutIntervalForRequest = 25
        configuration.timeoutIntervalForResource = 30
        configuration.urlCache = nil
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()
    init(proxyPort: UInt16) { self.proxyPort = proxyPort; super.init() }

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    func start() async throws -> String {
        try await withCheckedThrowingContinuation { continuation in
            queue.async {
                if let port = self.port { continuation.resume(returning: "http://127.0.0.1:\(port)/fees"); return }
                do {
                    let parameters = NWParameters.tcp
                    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: self.assignedPort.flatMap { NWEndpoint.Port(rawValue: $0) } ?? .any)
                    let listener = try NWListener(using: parameters)
                    self.listener = listener
                    var answered = false
                    listener.stateUpdateHandler = { state in
                        switch state {
                        case .ready:
                            guard !answered, let port = listener.port?.rawValue else { return }
                            answered = true; self.port = port; self.assignedPort = port
                            continuation.resume(returning: "http://127.0.0.1:\(port)/fees")
                        case .failed(let error):
                            self.port = nil; self.listener = nil
                            if !answered { answered = true; continuation.resume(throwing: error) }
                        default: break
                        }
                    }
                    listener.newConnectionHandler = { connection in self.serve(connection) }
                    listener.start(queue: self.queue)
                } catch { continuation.resume(throwing: error) }
            }
        }
    }

    static func accepts(_ request: Data) -> Bool {
        guard request.count <= 4096, let text = String(data: request, encoding: .utf8), text.contains("\r\n\r\n") else { return false }
        return text.hasPrefix("GET /fees HTTP/1.1\r\n") || text.hasPrefix("GET /fees HTTP/1.0\r\n")
    }

    private func serve(_ connection: NWConnection) {
        guard clients < 4 else { connection.cancel(); return }
        clients += 1
        var ended = false
        let finish = {
            guard !ended else { return }
            ended = true; self.clients -= 1; connection.cancel()
        }
        connection.stateUpdateHandler = { state in
            if case .failed = state { finish() }
            if case .cancelled = state { finish() }
        }
        connection.start(queue: queue)
        queue.asyncAfter(deadline: .now() + 35) { finish() }
        func read(_ previous: Data) {
            connection.receive(minimumIncompleteLength: 1, maximumLength: 4096) { data, _, complete, error in
                guard !ended else { return }
                let request = previous + (data ?? Data())
                guard error == nil, request.count <= 4096 else { finish(); return }
                if request.range(of: Data("\r\n\r\n".utf8)) == nil {
                    if complete { finish() } else { read(request) }
                    return
                }
                guard Self.accepts(request) else {
                    connection.send(content: Data("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".utf8), completion: .contentProcessed { _ in finish() }); return
                }
                Task {
                    let payload: Data?
                    do {
                        guard let session = self.session else { throw TransportFailure.requiresNewerSystem }
                        let (data, response) = try await session.data(from: URL(string: "https://nodex.kilombino.com/data/lnd-fees.json")!)
                        guard (response as? HTTPURLResponse)?.statusCode == 200, data.count <= 65536,
                              (try JSONSerialization.jsonObject(with: data)) is [String: Any] else { throw NodeFailure.invalidReply }
                        payload = data
                    } catch { payload = nil }
                    self.queue.async {
                        guard !ended else { return }
                        let body = payload ?? Data()
                        let status = payload == nil ? "503 Service Unavailable" : "200 OK"
                        let headers = "HTTP/1.1 \(status)\r\nContent-Type: application/json\r\nContent-Length: \(body.count)\r\nConnection: close\r\n\r\n"
                        connection.send(content: Data(headers.utf8) + body, completion: .contentProcessed { _ in finish() })
                    }
                }
            }
        }
        read(Data())
    }
}
