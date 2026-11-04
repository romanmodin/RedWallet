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
    // Onion endpoints require a Tor transport and are not accepted by this builder.
    public static func endpoint(_ value: String) throws -> String {
        let parts = value.split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, let port = UInt16(parts[1]), port > 0 else { throw NodeFailure.invalidPeer }
        let host = String(parts[0]).lowercased()
        guard host.utf8.count <= 253, !host.hasSuffix(".onion"), !host.isEmpty else { throw NodeFailure.invalidPeer }
        let labels = host.split(separator: ".", omittingEmptySubsequences: false)
        guard labels.allSatisfy({ label in
            !label.isEmpty && label.utf8.count <= 63 && label.first != "-" && label.last != "-" &&
            label.utf8.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }
        }) else { throw NodeFailure.invalidPeer }
        return host + ":" + String(port)
    }

    public static func text(peers: [String] = defaultPeers) throws -> String {
        guard !peers.isEmpty, peers.count <= 16 else { throw NodeFailure.invalidPeer }
        let endpoints = try peers.map(endpoint)
        return """
        [Application Options]
        debuglevel=info
        nolisten=true
        norest=true
        tlsdisableautofill=true
        alias=RedWallet
        nobootstrap=true
        maxpendingchannels=3
        [Bitcoin]
        bitcoin.mainnet=true
        bitcoin.node=neutrino
        [neutrino]
        \(endpoints.map { "neutrino.connect=" + $0 }.joined(separator: "\n"))
        neutrino.maxpeers=\(max(4, peers.count + 2))
        [fee]
        fee.url=https://nodex.kilombino.com/data/lnd-fees.json
        [wtclient]
        wtclient.active=true
        """
    }
}
