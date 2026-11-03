#if os(iOS) && !targetEnvironment(macCatalyst)
import Foundation
import React
import XBTLightning

@objc(XBTLightningBridge)
final class XBTLightningBridge: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(invoice:value:hash:sats:resolver:rejecter:)
    func invoice(_ operation: String, value: String, hash: String, sats: String,
                 resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch operation {
                case "receive":
                    let invoice = try await RegtestNode.shared.receive(sats: UInt64(sats) ?? 0)
                    resolve(invoice)
                case "decode":
                    let info = try await RegtestNode.shared.decode(value)
                    resolve(["sats": String(info.sats), "destination": info.destination, "hash": info.hash])
                case "pay":
                    let settled = try await RegtestNode.shared.pay(invoice: value, expectedHash: hash, expectedSats: UInt64(sats) ?? 0)
                    resolve(settled)
                default: reject("unknown_action", "Unknown invoice operation.", nil)
                }
            } catch { reject("invoice_error", error.localizedDescription, nil) }
        }
    }

    @objc(run:peer:resolver:rejecter:)
    func run(_ action: String, peer: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch action {
                case "start": try await RegtestNode.shared.start(peer: peer)
                case "setup": try await RegtestNode.shared.setupOrUnlock()
                case "history":
                    resolve(try await RegtestNode.shared.recentPayments())
                    return
                case "backup":
                    let backup = try await RegtestNode.shared.channelBackup()
                    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("xbt-regtest-channel-backup", isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let file = folder.appendingPathComponent("channel.backup")
                    try backup.write(to: file, options: [.atomic, .completeFileProtection])
                    resolve(file.absoluteString)
                    return
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
