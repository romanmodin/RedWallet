// JoinBlaket's only native destination. Tor configuration follows pinned Kilowallet rc6
// ArtiEngine.swift (6a07be1835dc650a6274a90eb0ffeb214b5310ef, Apache-2.0).
import Foundation
import Network
import UIKit

enum JoinBlaketTransportFailure: Error, LocalizedError {
    case invalid, closed, busy, unavailable, oversized
    var errorDescription: String? { "JoinBlaket Tor connection unavailable." }
}

/// One LF-delimited line, retaining CR for the protocol parser. Bound bytes before UTF-8 decoding.
struct JoinBlaketLineBuffer {
    static let limit = 65_536
    private var bytes = Data()

    mutating func append(_ chunk: Data) throws {
        guard bytes.count + chunk.count <= Self.limit else { throw JoinBlaketTransportFailure.oversized }
        bytes.append(chunk)
    }

    var remaining: Int { Self.limit - bytes.count }

    mutating func next() throws -> String? {
        guard let end = bytes.firstIndex(of: 10) else {
            guard bytes.count < Self.limit else { throw JoinBlaketTransportFailure.oversized }
            return nil
        }
        guard let text = String(data: bytes[..<end], encoding: .utf8) else { throw JoinBlaketTransportFailure.invalid }
        bytes.removeSubrange(...end)
        return text
    }

    static func outgoing(_ line: String) throws -> Data {
        guard line.hasSuffix("\r"), !line.dropLast().contains("\r"), !line.contains("\n") else {
            throw JoinBlaketTransportFailure.invalid
        }
        let data = Data((line + "\n").utf8)
        guard data.count <= limit else { throw JoinBlaketTransportFailure.oversized }
        return data
    }
}

protocol JoinBlaketLineConnection: AnyObject, Sendable {
    func open() async throws
    func readLine() async throws -> String?
    func writeLine(_ line: String) async throws
    func close() async
}

/// Every mutable field and Network.framework callback runs on queue.
final class JoinBlaketTorStream: JoinBlaketLineConnection, @unchecked Sendable {
    static let host = "f3tfzgk5ilwfapx427yx5ckeh7ptuvskfxnfnicfo747jyq5mgzdtvad.onion"
    static let port: UInt16 = 5222
    private let queue = DispatchQueue(label: "org.redwallet.joinblaket.tor")
    private let connection: NWConnection
    private var started = false
    private var ready = false
    private var finished = false
    private var buffer = JoinBlaketLineBuffer()
    private var opening: CheckedContinuation<Void, Error>?
    private var reading: CheckedContinuation<String?, Error>?
    private var writing: CheckedContinuation<Void, Error>?
    private var openTimer: DispatchWorkItem?
    private var writeTimer: DispatchWorkItem?

    @available(iOS 17.0, *)
    init(proxyPort: UInt16) throws {
        guard proxyPort > 0 else { throw JoinBlaketTransportFailure.unavailable }
        let params = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
        var proxy = ProxyConfiguration(socksv5Proxy: .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: proxyPort)!))
        proxy.allowFailover = false
        proxy.applyCredential(username: UUID().uuidString, password: "redwallet-joinblaket")
        let context = NWParameters.PrivacyContext(description: "RedWallet JoinBlaket Tor")
        context.proxyConfigurations = [proxy]
        params.setPrivacyContext(context)
        // The onion name is passed to SOCKS, never looked up by a direct socket or a DNS fallback.
        connection = NWConnection(host: NWEndpoint.Host(Self.host), port: NWEndpoint.Port(rawValue: Self.port)!, using: params)
    }

    func open() async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                guard !self.started, !self.finished else {
                    continuation.resume(throwing: JoinBlaketTransportFailure.closed); return
                }
                self.started = true
                self.opening = continuation
                let timer = DispatchWorkItem { [weak self] in self?.finish() }
                self.openTimer = timer
                self.queue.asyncAfter(deadline: .now() + 120, execute: timer)
                self.connection.stateUpdateHandler = { [weak self] state in
                    guard let self, !self.finished else { return }
                    switch state {
                    case .ready:
                        self.ready = true
                        self.openTimer?.cancel(); self.openTimer = nil
                        let pending = self.opening; self.opening = nil
                        pending?.resume()
                    case .failed, .waiting, .cancelled: self.finish()
                    default: break
                    }
                }
                self.connection.start(queue: self.queue)
            }
        }
    }

    func readLine() async throws -> String? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<String?, Error>) in
            queue.async {
                guard self.ready, !self.finished else {
                    continuation.resume(throwing: JoinBlaketTransportFailure.closed); return
                }
                guard self.reading == nil else {
                    continuation.resume(throwing: JoinBlaketTransportFailure.busy); return
                }
                self.reading = continuation
                self.receive()
            }
        }
    }

    private func receive() {
        guard !finished, reading != nil else { return }
        do {
            if let line = try buffer.next() {
                let pending = reading; reading = nil
                pending?.resume(returning: line)
                return
            }
        } catch { finish(); return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: min(16_384, buffer.remaining)) { [weak self] data, _, complete, error in
            guard let self, !self.finished else { return }
            guard error == nil else { self.finish(); return }
            do {
                if let data, !data.isEmpty { try self.buffer.append(data) }
                if complete {
                    // Do not deliver partial or unauthenticated final data from a closed connection.
                    self.finish(); return
                }
                self.receive()
            } catch { self.finish() }
        }
    }

    func writeLine(_ line: String) async throws {
        let data = try JoinBlaketLineBuffer.outgoing(line)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async {
                guard self.ready, !self.finished else {
                    continuation.resume(throwing: JoinBlaketTransportFailure.closed); return
                }
                guard self.writing == nil else {
                    continuation.resume(throwing: JoinBlaketTransportFailure.busy); return
                }
                self.writing = continuation
                let timer = DispatchWorkItem { [weak self] in self?.finish() }
                self.writeTimer = timer
                self.queue.asyncAfter(deadline: .now() + 30, execute: timer)
                self.connection.send(content: data, completion: .contentProcessed { [weak self] error in
                    guard let self, !self.finished else { return }
                    guard error == nil else { self.finish(); return }
                    self.writeTimer?.cancel(); self.writeTimer = nil
                    let pending = self.writing; self.writing = nil
                    pending?.resume()
                })
            }
        }
    }

    private func finish() {
        guard !finished else { return }
        finished = true; ready = false
        openTimer?.cancel(); openTimer = nil
        writeTimer?.cancel(); writeTimer = nil
        connection.stateUpdateHandler = nil
        connection.cancel()
        let open = opening, read = reading, write = writing
        opening = nil; reading = nil; writing = nil
        buffer = JoinBlaketLineBuffer()
        open?.resume(throwing: JoinBlaketTransportFailure.closed)
        read?.resume(throwing: JoinBlaketTransportFailure.closed)
        write?.resume(throwing: JoinBlaketTransportFailure.closed)
    }

    func close() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async { self.finish(); continuation.resume() }
        }
    }
}

/// Owns at most one directory connection; no payment or wallet keys cross this API.
public actor JoinBlaketTransport {
    public static let shared = JoinBlaketTransport()
    private struct Slot { let id: String; var stream: (any JoinBlaketLineConnection)? }
    private var slot: Slot?
    // Prevent close-before-open bridge races and reuse of a stale handle. Bounded per process.
    private var retired = Set<String>()
    private let startTor: @Sendable () async throws -> UInt16
    private let makeStream: @Sendable (UInt16) throws -> any JoinBlaketLineConnection
    private let isForeground: @Sendable () async -> Bool

    init(startTor: @escaping @Sendable () async throws -> UInt16 = { (try await LightningTor.shared.start()).port },
         makeStream: @escaping @Sendable (UInt16) throws -> any JoinBlaketLineConnection = { port in
             guard #available(iOS 17.0, *) else { throw JoinBlaketTransportFailure.unavailable }
             return try JoinBlaketTorStream(proxyPort: port)
         }, isForeground: @escaping @Sendable () async -> Bool = {
             await MainActor.run { UIApplication.shared.applicationState == .active }
         }) {
        self.startTor = startTor; self.makeStream = makeStream; self.isForeground = isForeground
    }

    private func valid(_ id: String) -> Bool {
        id.utf8.count == 32 && id.utf8.allSatisfy { ($0 >= 48 && $0 <= 57) || ($0 >= 97 && $0 <= 102) }
    }

    public func open(_ id: String) async throws {
        guard await isForeground() else { throw JoinBlaketTransportFailure.unavailable }
        guard valid(id), !retired.contains(id), retired.count < 10_000 else { throw JoinBlaketTransportFailure.invalid }
        guard slot == nil else { throw JoinBlaketTransportFailure.busy }
        slot = Slot(id: id, stream: nil)
        var owned: (any JoinBlaketLineConnection)?
        do {
            let port = try await startTor()
            guard await isForeground(), slot?.id == id else { throw JoinBlaketTransportFailure.closed }
            let stream = try makeStream(port)
            owned = stream
            slot = Slot(id: id, stream: stream)
            try await stream.open()
            guard await isForeground(), slot?.id == id else { throw JoinBlaketTransportFailure.closed }
        } catch {
            if slot?.id == id { slot = nil }
            retired.insert(id)
            await owned?.close()
            throw JoinBlaketTransportFailure.unavailable
        }
    }

    private func stream(_ id: String) throws -> any JoinBlaketLineConnection {
        guard slot?.id == id, let stream = slot?.stream else { throw JoinBlaketTransportFailure.closed }
        return stream
    }

    public func readLine(_ id: String) async throws -> String? {
        let current = try stream(id)
        do {
            let line = try await current.readLine()
            guard slot?.id == id else { throw JoinBlaketTransportFailure.closed }
            return line
        } catch { await close(id); throw JoinBlaketTransportFailure.closed }
    }

    public func writeLine(_ id: String, line: String) async throws {
        let current = try stream(id)
        do {
            try await current.writeLine(line)
            guard slot?.id == id else { throw JoinBlaketTransportFailure.closed }
        } catch { await close(id); throw JoinBlaketTransportFailure.closed }
    }

    public func close(_ id: String) async {
        guard valid(id) else { return }
        if retired.count < 10_000 { retired.insert(id) }
        guard slot?.id == id else { return }
        let old = slot?.stream; slot = nil
        await old?.close()
    }

    public func closeAll() async {
        if let id = slot?.id { await close(id) }
    }
}
