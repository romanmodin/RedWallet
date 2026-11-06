// Adapted from Kilombino/kilowallet-ios ArtiEngine.swift (Apache-2.0).
// Native runtime and source pins are recorded in docs/lightning-tor.md.
import Foundation
import Darwin
import KilombinoTor

enum ArtiRuntime {
    /// Nil once the SOCKS port listens, else why Tor could not start. Blocking: never on the main thread.
    static func start(dir: String, logPath: String, port: Int32) -> String? {
        let out: UnsafeMutablePointer<CChar>? = dir.withCString { d in
            logPath.withCString { l in kilombino_tor_start(d, l, UInt16(truncatingIfNeeded: port)) }
        }
        guard let out = out else { return nil }
        defer { kilombino_tor_free(out) }
        return String(cString: out)
    }

    static func stop() { kilombino_tor_stop() }

    /// 0: not running. 1: connecting. 2: the SOCKS port carries traffic.
    static func state() -> Int32 { kilombino_tor_state() }

    /// A port free on 127.0.0.1 right now (the system picks it).
    static func freePort() -> Int32 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return 0 }
        defer { close(fd) }
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let ok = withUnsafeMutablePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { sp -> Bool in
                bind(fd, sp, len) == 0 && getsockname(fd, sp, &len) == 0
            }
        }
        return ok ? Int32(UInt16(bigEndian: addr.sin_port)) : 0
    }

    /// True when 127.0.0.1:port answers a SOCKS5 greeting (no authentication) as Arti does: after
    /// the app was suspended, iOS may have taken the listening socket back.
    static func socksAnswers(port: Int32) -> Bool {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { return false }
        defer { close(fd) }
        var on: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &on, socklen_t(MemoryLayout<Int32>.size))
        var tv = timeval(tv_sec: 3, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, socklen_t(MemoryLayout<timeval>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = UInt16(truncatingIfNeeded: port).bigEndian
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        let connected = withUnsafePointer(to: &addr) { p in
            p.withMemoryRebound(to: sockaddr.self, capacity: 1) { connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) == 0 }
        }
        guard connected else { return false }
        let hello: [UInt8] = [5, 1, 0]
        guard send(fd, hello, hello.count, 0) == hello.count else { return false }
        var reply = [UInt8](repeating: 0, count: 2)
        guard recv(fd, &reply, 2, MSG_WAITALL) == 2 else { return false }
        return reply[0] == 5 && reply[1] == 0
    }
}

