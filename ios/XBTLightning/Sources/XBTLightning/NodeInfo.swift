import Foundation
import Security
import Lndmobile

enum NodeFailure: LocalizedError {
    case invalidReply, timedOut, invalidPeer, missingCredentials, invalidAmount, invalidRecovery, notSynced
    case keychain(OSStatus)
    var errorDescription: String? {
        switch self {
        case .notSynced: return "Wait for the XBT chain to finish syncing before using channels or payments."
        case .keychain(let code): return "Keychain could not access the Lightning wallet (status \(code))."
        case .invalidReply: return "The Lightning engine returned an invalid response."
        case .timedOut: return "The Lightning engine has not answered yet. Check its status again."
        case .invalidPeer: return "Enter a valid chain or Lightning peer address."
        case .missingCredentials: return "The saved credentials for this Lightning node are unavailable."
        case .invalidRecovery: return "Check the recovery file for this network and its passphrase (at least 12 characters). Restore only to a new Lightning node."
        case .invalidAmount: return "Enter a whole amount between 1 and 1,000,000 sats."
        }
    }
}

// Mobile Start can report a daemon error after the initial success. Each async
// caller must complete exactly once, including when its RPC times out.
private final class Reply: NSObject, LndmobileCallbackProtocol {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<Data, Error>?
    private var timer: DispatchWorkItem?

    init(_ continuation: CheckedContinuation<Data, Error>) {
        self.continuation = continuation
        super.init()
        let timer = DispatchWorkItem { [weak self] in self?.finish(.failure(NodeFailure.timedOut)) }
        self.timer = timer
        DispatchQueue.global().asyncAfter(deadline: .now() + 60, execute: timer)
    }

    private func finish(_ result: Result<Data, Error>) {
        lock.lock()
        let pending = continuation
        continuation = nil
        timer?.cancel()
        timer = nil
        lock.unlock()
        pending?.resume(with: result)
    }

    func onResponse(_ response: Data?) { finish(.success(response ?? Data())) }
    func onError(_ error: Error?) { finish(.failure(error ?? NodeFailure.invalidReply)) }
}

func rpc(_ send: (LndmobileCallbackProtocol) -> Void) async throws -> Data {
    try await withCheckedThrowingContinuation { continuation in send(Reply(continuation)) }
}

public enum XBTLightningNode {
    public static func info() async throws -> Data {
        try await rpc { LndmobileGetInfo(Data(), $0) }
    }
}
