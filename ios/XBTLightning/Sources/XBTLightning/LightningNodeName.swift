import Foundation

enum NodeNameFailure: LocalizedError {
    case invalid, starting
    var errorDescription: String? {
        switch self {
        case .invalid: return "Enter a node name of 1–32 UTF-8 bytes. Avoid line breaks, control characters and config punctuation (quotes, backslashes, brackets, #, ;, =)."
        case .starting: return "Wait for the Lightning node to finish starting, then save its name."
        }
    }
}

enum LightningNodeName {
    static let defaultValue = "RedWallet"

    static func validate(_ input: String) throws -> String {
        let forbidden = CharacterSet.controlCharacters
            .union(.newlines)
            .union(CharacterSet(charactersIn: "\"'\\[]#;="))
        guard !input.unicodeScalars.contains(where: { forbidden.contains($0) }) else { throw NodeNameFailure.invalid }
        let value = input.trimmingCharacters(in: .whitespaces)
        guard !value.isEmpty, value.utf8.count <= 32 else { throw NodeNameFailure.invalid }
        return value
    }

    static func load(at file: URL) throws -> String {
        guard FileManager.default.fileExists(atPath: file.path) else { return defaultValue }
        return try validate(JSONDecoder().decode(String.self, from: Data(contentsOf: file)))
    }

    static func save(_ input: String, at file: URL) throws {
        let value = try validate(input)
        try FileManager.default.createDirectory(at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    static func state(saved: String, active: String?) -> [String: Any] {
        ["saved": saved, "active": active ?? "", "restartRequired": active != nil && saved != active]
    }
}
