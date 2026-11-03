import Foundation
import Lndmobile

/// Read the local XBT node's serialized lnrpc.GetInfoResponse after RPC is ready.
public enum XBTLightningNode {
    public static func info() async throws -> Data {
        try await withCheckedThrowingContinuation { continuation in
            LndmobileGetInfo(Data(), InfoCallback(continuation))
        }
    }
}

private final class InfoCallback: NSObject, LndmobileCallbackProtocol {
    private let continuation: CheckedContinuation<Data, Error>

    init(_ continuation: CheckedContinuation<Data, Error>) {
        self.continuation = continuation
    }

    func onResponse(_ response: Data?) {
        if let response, !response.isEmpty {
            continuation.resume(returning: response)
        } else {
            continuation.resume(throwing: CocoaError(.coderReadCorrupt))
        }
    }

    func onError(_ error: Error?) {
        continuation.resume(throwing: error ?? CocoaError(.coderValueNotFound))
    }
}
