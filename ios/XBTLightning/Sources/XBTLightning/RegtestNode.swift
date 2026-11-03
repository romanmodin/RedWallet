import Foundation
import CryptoKit
import Security
import Lndmobile

public actor RegtestNode {
    public static let shared = RegtestNode()
    private var startup: Task<Void, Error>?
    private var provisioning = false
    private let service = "com.redwallet.xbt-lightning.regtest.v1"

    // Accept a literal local IPv4 address only. Neither a URL nor arbitrary LND
    // config text is accepted from the app.
    static func privatePeer(_ host: String) throws -> String {
        let components = host.split(separator: ".", omittingEmptySubsequences: false)
        let ip = components.compactMap { UInt8($0) }
        guard ip.count == 4, ip.map(String.init).joined(separator: ".") == host,
              ip[0] == 127 || ip[0] == 10 || (ip[0] == 192 && ip[1] == 168) ||
              (ip[0] == 172 && (16...31).contains(ip[1])) else { throw NodeFailure.invalidPeer }
        return host
    }

    public func start(peer: String = "127.0.0.1") async throws {
        let peer = try Self.privatePeer(peer)
        if let startup { return try await startup.value }
        let task = Task<Void, Error> {
            let manager = FileManager.default
            var folder = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                .appendingPathComponent("XBTLightning-regtest", isDirectory: true)
            try manager.createDirectory(at: folder, withIntermediateDirectories: true,
                                        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
            var flags = URLResourceValues()
            flags.isExcludedFromBackup = true
            try folder.setResourceValues(flags)
            let conf = folder.appendingPathComponent("lnd.conf")
            // Regtest only. No public peers, listener, remote REST API or mainnet discovery.
            try """
            [Application Options]
            nolisten=true
            norest=true
            nobootstrap=true
            tlsdisableautofill=true
            [Bitcoin]
            bitcoin.regtest=true
            bitcoin.blake2b-activation-height=150
            bitcoin.node=neutrino
            [neutrino]
            neutrino.connect=\(peer):18444
            """.write(to: conf, atomically: true, encoding: .utf8)
            _ = try await rpc { LndmobileStart("--lnddir=" + folder.path + " --configfile=" + conf.path, $0) }
        }
        startup = task
        // The Go engine is process-wide. A timeout does not establish it stopped.
        try await task.value
        // The mobile startup callback only means that the transport is listening.
        for _ in 0..<30 {
            if try await status() != "Starting" { return }
            try await Task.sleep(nanoseconds: 250_000_000)
        }
    }

    public func status() async throws -> String {
        guard startup != nil else { return "Stopped" }
        let fields = try ProtoFields(await rpc { LndmobileGetState(Data(), $0) })
        switch fields.integers[1] ?? 0 {
        case 0: return "Needs setup"
        case 1: return "Locked"
        case 2: return "Unlocked"
        case 3: return "RPC ready"
        case 4: return "Running"
        case 255: return "Starting"
        default: throw NodeFailure.invalidReply
        }
    }

    private func pendingCreationURL() throws -> URL {
        try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
            .appendingPathComponent("XBTLightning-regtest/pending-creation")
    }

    private struct Credentials: Codable {
        let password: Data
        let words: [Data]
    }

    private func credentials(create: Bool, restoring: [Data]? = nil) async throws -> Credentials {
        let match: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                     kSecAttrService as String: service, kSecAttrAccount as String: "node"]
        var query = match
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        let lookup = SecItemCopyMatching(query as CFDictionary, &item)
        if lookup == errSecSuccess, let data = item as? Data {
            let saved = try JSONDecoder().decode(Credentials.self, from: data)
            guard saved.words.count == 24 && saved.password.count == 32 else { throw NodeFailure.missingCredentials }
            // A previous installation can leave its Keychain entry behind.
            // Never silently initialize a second channel node with that identity.
            if create && restoring != saved.words {
                let pending = try? Data(contentsOf: pendingCreationURL())
                guard restoring == nil && pending == Data(SHA256.hash(data: saved.password)) else { throw NodeFailure.invalidRecovery }
            }
            return saved
        }
        guard lookup == errSecItemNotFound else { throw NodeFailure.keychain(lookup) }
        guard create else { throw NodeFailure.missingCredentials }
        let words: [Data]
        if let restoring { words = restoring }
        else {
            let fields = try ProtoFields(await rpc { LndmobileGenSeed(Data(), $0) })
            words = fields.bytes[1] ?? []
        }
        guard words.count == 24, words.allSatisfy({ !$0.isEmpty }) else { throw NodeFailure.invalidReply }
        var password = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, password.count, &password) == errSecSuccess else { throw NodeFailure.missingCredentials }
        let saved = Credentials(password: Data(password), words: words)
        var addition = match
        addition[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        addition[kSecValueData as String] = try JSONEncoder().encode(saved)
        if restoring == nil {
            try Data(SHA256.hash(data: saved.password)).write(to: pendingCreationURL(), options: [.atomic, .completeFileProtection])
        }
        let added = SecItemAdd(addition as CFDictionary, nil)
        guard added == errSecSuccess else { throw NodeFailure.keychain(added) }
        return saved
    }

    public func recoveryFile(phrase: String) async throws -> Data {
        let saved = try await credentials(create: false)
        let channels = try await channelBackup()
        return try RecoveryFile.seal(.init(words: saved.words, channelBackup: channels), phrase: phrase)
    }

    public func restore(file: Data, phrase: String) async throws {
        guard !provisioning else { throw NodeFailure.invalidRecovery }
        provisioning = true
        defer { provisioning = false }
        guard try await status() == "Needs setup" else { throw NodeFailure.invalidRecovery }
        let material = try RecoveryFile.open(file, phrase: phrase)
        let saved = try await credentials(create: true, restoring: material.words)
        let snapshot = ProtoFields.field(2, data: ProtoFields.field(2, data: material.channelBackup))
        var request = ProtoFields.field(1, data: saved.password) + ProtoFields.field(4, integer: 2500) + ProtoFields.field(5, data: snapshot)
        for word in saved.words { request += ProtoFields.field(2, data: word) }
        _ = try await rpc { LndmobileInitWallet(request, $0) }
    }

    public func setupOrUnlock() async throws {
        guard !provisioning else { throw NodeFailure.invalidReply }
        provisioning = true
        defer { provisioning = false }
        switch try await status() {
        case "Needs setup":
            let saved = try await credentials(create: true)
            var request = ProtoFields.field(1, data: saved.password)
            for word in saved.words { request += ProtoFields.field(2, data: word) }
            _ = try await rpc { LndmobileInitWallet(request, $0) }
            try? FileManager.default.removeItem(at: pendingCreationURL())
        case "Locked":
            let saved = try await credentials(create: false)
            _ = try await rpc { LndmobileUnlockWallet(ProtoFields.field(1, data: saved.password), $0) }
        default: throw NodeFailure.invalidReply
        }
    }
}
