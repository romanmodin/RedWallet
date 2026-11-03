import CommonCrypto
import CryptoKit
import Foundation
import Security

// Versioned RedWallet regtest backup. The file holds aezeed and the encrypted
// static channel backup; an old live channel database must never be restored.
enum RecoveryFile {
    private static let header = Data("RedWallet-XBT-regtest-1\n".utf8)
    static let maximumBytes = 4 * 1024 * 1024

    struct Material: Codable {
        let words: [Data]
        let channelBackup: Data
    }

    private static func key(_ phrase: String, salt: Data) throws -> SymmetricKey {
        let password = Array(phrase.utf8)
        guard (12...512).contains(password.count), salt.count == 16 else { throw NodeFailure.invalidRecovery }
        var derived = [UInt8](repeating: 0, count: 32)
        let result = password.withUnsafeBytes { passwordBuffer in
            salt.withUnsafeBytes { saltBuffer in
                CCKeyDerivationPBKDF(CCPBKDFAlgorithm(kCCPBKDF2),
                    passwordBuffer.baseAddress!.assumingMemoryBound(to: Int8.self), password.count,
                    saltBuffer.baseAddress!.assumingMemoryBound(to: UInt8.self), salt.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256), 600_000, &derived, 32)
            }
        }
        guard result == kCCSuccess else { throw NodeFailure.invalidRecovery }
        return SymmetricKey(data: derived)
    }

    static func seal(_ material: Material, phrase: String) throws -> Data {
        var salt = [UInt8](repeating: 0, count: 16)
        guard SecRandomCopyBytes(kSecRandomDefault, salt.count, &salt) == errSecSuccess else { throw NodeFailure.invalidRecovery }
        let prefix = header + Data(salt)
        let clear = try JSONEncoder().encode(material)
        guard clear.count + prefix.count + 28 <= maximumBytes else { throw NodeFailure.invalidRecovery }
        let sealed = try AES.GCM.seal(clear, using: key(phrase, salt: Data(salt)), authenticating: prefix)
        guard let bytes = sealed.combined else { throw NodeFailure.invalidRecovery }
        return prefix + bytes
    }

    static func open(_ file: Data, phrase: String) throws -> Material {
        let prefixSize = header.count + 16
        guard file.count <= maximumBytes, file.count >= prefixSize + 28, file.starts(with: header) else { throw NodeFailure.invalidRecovery }
        let prefix = file.prefix(prefixSize)
        let sealed = try AES.GCM.SealedBox(combined: file.dropFirst(prefixSize))
        let clear = try AES.GCM.open(sealed, using: key(phrase, salt: Data(prefix.suffix(16))), authenticating: prefix)
        let material = try JSONDecoder().decode(Material.self, from: clear)
        guard material.words.count == 24, material.words.allSatisfy({ (1...16).contains($0.count) }), !material.channelBackup.isEmpty else {
            throw NodeFailure.invalidRecovery
        }
        return material
    }
}
