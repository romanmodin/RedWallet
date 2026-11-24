import Foundation
import React
import UIKit

@objc(RedWalletSeparationHTTP)
final class RedWalletSeparationHTTP: NSObject, RCTInvalidating {
    private let transport = SeparationHTTPTransport()
    private var backgroundObserver: NSObjectProtocol?
    // Calls from JS register and cancel on one queue, in bridge order.
    @objc var methodQueue: DispatchQueue { DispatchQueue.main }
    @objc static func requiresMainQueueSetup() -> Bool { false }
    @objc func constantsToExport() -> [AnyHashable: Any] {
        let scope = Bundle.main.object(forInfoDictionaryKey: "RedWalletKeystoneScope") as? String
        return ["internalKeystone": scope == "internal-testing"]
    }
    override init() {
        super.init()
        backgroundObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main
        ) { [weak self] _ in self?.transport.cancelAll() }
    }

    @objc(get:url:limit:resolver:rejecter:)
    func get(_ identifier: String, url: String, limit: Double,
             resolver resolve: @escaping RCTPromiseResolveBlock,
             rejecter reject: @escaping RCTPromiseRejectBlock) {
        guard UIApplication.shared.applicationState == .active, limit.isFinite, limit >= 1, limit <= 2_000_000, limit.rounded(.down) == limit else {
            reject("proof_http_invalid", "Invalid separation evidence request.", nil); return
        }
        transport.get(id: identifier, url: url, limit: Int(limit)) { result in
            switch result {
            case .success(let value): resolve(["status": 200, "url": value.url, "body": value.body, "serverTime": value.serverTime])
            case .failure: reject("proof_http_failed", "Coin separation evidence request failed.", nil)
            }
        }
    }

    @objc func cancel(_ identifier: String) { transport.cancel(id: identifier) }
    @objc func invalidate() {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        backgroundObserver = nil
        transport.invalidate()
    }
    deinit {
        if let backgroundObserver { NotificationCenter.default.removeObserver(backgroundObserver) }
        transport.invalidate()
    }
}
