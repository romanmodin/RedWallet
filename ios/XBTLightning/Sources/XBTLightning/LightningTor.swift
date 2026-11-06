import Foundation

struct LightningTorConnection {
    let port: UInt16
    let feeURL: String
}

actor LightningTor {
    static let shared = LightningTor()
    private var port: UInt16?
    private var pending: Task<LightningTorConnection, Error>?
    private var feeServer: TorFeeService?

    func status() -> String {
        switch ArtiRuntime.state() {
        case 2: return "Tor ready"
        case 1: return "Connecting to Tor…"
        default: return "Tor stopped"
        }
    }

    func start() async throws -> LightningTorConnection {
        guard #available(iOS 17.0, *) else { throw TransportFailure.requiresNewerSystem }
        if let pending { return try await pending.value }
        if port == nil {
            let free = ArtiRuntime.freePort()
            guard free > 0 else { throw TransportFailure.torUnavailable }
            port = UInt16(free)
        }
        let selectedPort = port!
        let task = Task<LightningTorConnection, Error> {
            var folder = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                appropriateFor: nil, create: true).appendingPathComponent("XBTLightning-Tor", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true,
                attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var flags = URLResourceValues(); flags.isExcludedFromBackup = true
            try folder.setResourceValues(flags)
            let dir = folder.path, log = folder.appendingPathComponent("tor.log").path
            try await Task.detached {
                if ArtiRuntime.state() == 2 && ArtiRuntime.socksAnswers(port: Int32(selectedPort)) { return }
                if ArtiRuntime.state() != 0 {
                    ArtiRuntime.stop()
                    for _ in 0..<30 where ArtiRuntime.state() != 0 { try await Task.sleep(nanoseconds: 200_000_000) }
                }
                guard ArtiRuntime.state() == 0,
                      ArtiRuntime.start(dir: dir, logPath: log, port: Int32(selectedPort)) == nil else {
                    throw TransportFailure.torUnavailable
                }
                for _ in 0..<120 {
                    try Task.checkCancellation()
                    if ArtiRuntime.state() == 2 && ArtiRuntime.socksAnswers(port: Int32(selectedPort)) { return }
                    if ArtiRuntime.state() == 0 { break }
                    try await Task.sleep(nanoseconds: 1_000_000_000)
                }
                throw TransportFailure.torUnavailable
            }.value
            // The pinned LND web fee estimator uses Go's direct HTTP dialer.
            // Only a loopback fee endpoint is given to LND; its upstream uses Tor with no failover.
            if feeServer == nil { feeServer = TorFeeService(proxyPort: selectedPort) }
            let feeURL = try await feeServer!.start()
            return LightningTorConnection(port: selectedPort, feeURL: feeURL)
        }
        pending = task
        do { let value = try await task.value; pending = nil; return value }
        catch { pending = nil; throw error }
    }
}
