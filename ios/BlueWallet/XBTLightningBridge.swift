#if os(iOS) && !targetEnvironment(macCatalyst)
import Foundation
import React
import XBTLightning

@objc(XBTLightningBridge)
final class XBTLightningBridge: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(run:resolver:rejecter:)
    func run(_ action: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch action {
                case "start": try await RegtestNode.shared.start()
                case "setup": try await RegtestNode.shared.setupOrUnlock()
                case "status": break
                default: reject("unknown_action", "Unknown Lightning operation.", nil); return
                }
                let status = try await RegtestNode.shared.status()
                resolve(status)
            } catch {
                reject("node_unavailable", error.localizedDescription, nil)
            }
        }
    }
}
#endif
