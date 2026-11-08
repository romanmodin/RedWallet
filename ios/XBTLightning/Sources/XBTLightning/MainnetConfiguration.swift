import Foundation

// Peer selection and Neutrino setup adapted from Kilombino/kilowallet-ios,
// core/.../ln/Lnd.kt at 0ec864d (Apache-2.0). Do not use Bitcoin DNS seeds:
// they discover the SHA256d chain instead of XBT.
public enum MainnetConfiguration {
    public static let directoryName = "XBTLightning-mainnet"
    public static let credentialService = "com.redwallet.xbt-lightning.mainnet.v1"
    public static let defaultPeers = [
        "ln.kilombino.com:11010",
        "nodoblake2b.airdns.org:11010",
        "179.27.118.130:8343",
        "82.67.102.15:8333",
        "home.skyhawk.ca:8333"
    ]

    // Only host:port endpoints, never arbitrary config lines or URLs.
    // Onion endpoints are accepted only with an active Tor transport.
    public static func endpoint(_ value: String, usingTor: Bool = false) throws -> String {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, let port = UInt16(parts[1]), port > 0 else { throw NodeFailure.invalidPeer }
        let host = String(parts[0]).lowercased()
        guard host.utf8.count <= 253, !host.isEmpty else { throw NodeFailure.invalidPeer }
        if host.hasSuffix(".onion") {
            guard usingTor else { throw TransportFailure.requiresTor }
            let name = host.dropLast(6)
            guard name.utf8.count == 56,
                  name.utf8.allSatisfy({ (97...122).contains($0) || (50...55).contains($0) }) else { throw NodeFailure.invalidPeer }
            return host + ":" + String(port)
        }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.allSatisfy({ label in
            !label.isEmpty && label.utf8.count <= 63 && label.first != "-" && label.last != "-" &&
            label.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }
        }) else { throw NodeFailure.invalidPeer }
        return host + ":" + String(port)
    }

    public static func text(peers: [String] = defaultPeers, torPort: UInt16? = nil, torFeeURL: String? = nil) throws -> String {
        guard !peers.isEmpty, peers.count <= 16 else { throw NodeFailure.invalidPeer }
        let endpoints = try peers.map { try endpoint($0, usingTor: torPort != nil) }
        var feeURL = "https://nodex.kilombino.com/data/lnd-fees.json"
        var transport = ""
        if let torPort {
            guard torPort > 0, let local = torFeeURL, let url = URLComponents(string: local),
                  url.scheme == "http", url.host == "127.0.0.1", url.path == "/fees",
                  let port = url.port, (1...65535).contains(port), url.query == nil, url.fragment == nil,
                  url.user == nil, url.password == nil, !local.contains("\n"), !local.contains("\r") else { throw NodeFailure.invalidPeer }
            feeURL = local
            transport = "\n[tor]\ntor.active=true\ntor.socks=127.0.0.1:\(torPort)\ntor.streamisolation=true\ntor.skip-proxy-for-clearnet-targets=false\n"
        } else if torFeeURL != nil { throw NodeFailure.invalidPeer }
        return """
        [Application Options]
        debuglevel=info
        nolisten=true
        norest=true
        tlsdisableautofill=true
        alias=RedWallet
        nobootstrap=true
        maxpendingchannels=3
        protocol.splice=true
        protocol.wumbo-channels=true
        maxchansize=2100000000000000
        [Bitcoin]
        bitcoin.mainnet=true
        bitcoin.node=neutrino
        [neutrino]
        \(endpoints.map { "neutrino.connect=" + $0 }.joined(separator: "\n"))
        neutrino.maxpeers=\(max(4, peers.count + 2))
        [fee]
        fee.url=\(feeURL)
        [wtclient]
        wtclient.active=true
        """ + transport
    }
}

// Keep the explicit user selection separate from LND's generated configuration.
// A corrupt setting is an error; it must never silently fall back to public peers.
enum MainnetPeerStore {
    static func load(at file: URL) throws -> String {
        guard FileManager.default.fileExists(atPath: file.path) else { return "" }
        let saved = try JSONDecoder().decode(String.self, from: Data(contentsOf: file))
        return saved.isEmpty ? "" : try MainnetConfiguration.endpoint(saved, usingTor: true)
    }

    static func save(_ peer: String, at file: URL) throws {
        let value = peer.isEmpty ? "" : try MainnetConfiguration.endpoint(peer, usingTor: true)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: file, options: .atomic)
    }
}
