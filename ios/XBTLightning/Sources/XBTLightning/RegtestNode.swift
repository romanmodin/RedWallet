import Foundation
import Security
import Lndmobile

public actor RegtestNode {
    public static let shared = RegtestNode()
    private var startup: Task<Void, Error>?
    private var provisioning = false
    private let service = "com.redwallet.xbt-lightning.regtest.v1"

    public func start() async throws {
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
            bitcoin.node=neutrino
            [neutrino]
            neutrino.connect=127.0.0.1:18444
            """.write(to: conf, atomically: true, encoding: .utf8)
            _ = try await rpc { LndmobileStart("--lnddir=" + folder.path + " --configfile=" + conf.path, $0) }
        }
        startup = task
        // The Go engine is process-wide. A timeout does not establish it stopped.
        try await task.value
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

    private struct Credentials: Codable {
        let password: Data
        let words: [Data]
    }

    private func credentials(create: Bool) async throws -> Credentials {
        let match: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                     kSecAttrService as String: service, kSecAttrAccount as String: "node"]
        var query = match
        query[kSecReturnData as String] = true
        var item: CFTypeRef?
        let lookup = SecItemCopyMatching(query as CFDictionary, &item)
        if lookup == errSecSuccess, let data = item as? Data {
            let saved = try JSONDecoder().decode(Credentials.self, from: data)
            guard saved.words.count == 24 && saved.password.count == 32 else { throw NodeFailure.missingCredentials }
            return saved
        }
        guard lookup == errSecItemNotFound, create else { throw NodeFailure.missingCredentials }
        let fields = try ProtoFields(await rpc { LndmobileGenSeed(Data(), $0) })
        guard let words = fields.bytes[1], words.count == 24, words.allSatisfy({ !$0.isEmpty }) else { throw NodeFailure.invalidReply }
        var password = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, password.count, &password) == errSecSuccess else { throw NodeFailure.missingCredentials }
        let saved = Credentials(password: Data(password), words: words)
        var addition = match
        addition[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        addition[kSecValueData as String] = try JSONEncoder().encode(saved)
        guard SecItemAdd(addition as CFDictionary, nil) == errSecSuccess else { throw NodeFailure.missingCredentials }
        return saved
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
        case "Locked":
            let saved = try await credentials(create: false)
            _ = try await rpc { LndmobileUnlockWallet(ProtoFields.field(1, data: saved.password), $0) }
        default: throw NodeFailure.invalidReply
        }
    }
}
