#if os(iOS) && !targetEnvironment(macCatalyst)
import Foundation
import React
import XBTLightning

@objc(XBTLightningBridge)
final class XBTLightningBridge: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(recovery:phrase:source:resolver:rejecter:)
    func recovery(_ operation: String, phrase: String, source: String,
                  resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch operation {
                case "export":
                    let bytes = try await RegtestNode.shared.recoveryFile(phrase: phrase)
                    let file = FileManager.default.temporaryDirectory.appendingPathComponent("RedWallet-regtest-" + UUID().uuidString + ".rwln")
                    try bytes.write(to: file, options: [.atomic, .completeFileProtection])
                    resolve(file.absoluteString)
                case "restore":
                    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath()
                    guard let url = URL(string: source), url.isFileURL,
                          url.resolvingSymlinksInPath().path.hasPrefix(caches.path + "/") else {
                        reject("invalid_file", "Choose a local regtest recovery file.", nil); return
                    }
                    let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard properties.isRegularFile == true, let size = properties.fileSize, size <= 4 * 1024 * 1024 else {
                        reject("invalid_file", "Invalid regtest recovery file.", nil); return
                    }
                    try await RegtestNode.shared.restore(file: Data(contentsOf: url), phrase: phrase)
                    resolve("Recovery submitted.")
                default: reject("unknown_action", "Unknown recovery operation.", nil)
                }
            } catch { reject("recovery_failed", "Recovery failed. Check the file, passphrase and node state.", nil) }
        }
    }

    @objc(invoice:value:hash:sats:resolver:rejecter:)
    func invoice(_ operation: String, value: String, hash: String, sats: String,
                 resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch operation {
                case "connect":
                    try await RegtestNode.shared.connect(to: value)
                    resolve("Peer connected.")
                case "open":
                    resolve(try await RegtestNode.shared.openChannel(to: value, sats: UInt64(sats) ?? 0))
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
                case "details":
                    resolve(try await RegtestNode.shared.details())
                    return
                case "fund":
                    resolve(try await RegtestNode.shared.fundingAddress())
                    return
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
