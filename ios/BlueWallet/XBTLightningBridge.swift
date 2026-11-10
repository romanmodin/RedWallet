#if os(iOS) && !targetEnvironment(macCatalyst)
import Foundation
import React
import XBTLightning

@objc(XBTLightningBridge)
final class XBTLightningBridge: NSObject {
    @objc static func requiresMainQueueSetup() -> Bool { false }

    @objc(network:value:resolver:rejecter:)
    func network(_ action: String, value: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                if action == "select" { try await RegtestNode.shared.selectTransport(value) }
                else if action != "get" && action != "resume" { throw NSError(domain: "Network", code: 1) }
                resolve(try await RegtestNode.shared.networkState(resume: action == "resume"))
            } catch { reject("network_failed", error.localizedDescription, nil) }
        }
    }

    @objc(watchtower:value:resolver:rejecter:)
    func watchtower(_ action: String, value: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch action {
                case "add": try await RegtestNode.shared.addWatchtower(value)
                case "remove": try await RegtestNode.shared.removeWatchtower(value)
                case "list": break
                default: throw NSError(domain: "Watchtower", code: 1)
                }
                resolve(try await RegtestNode.shared.watchtowers().map {
                    ["key": $0.key, "addresses": $0.addresses, "eligible": $0.eligible, "sessions": String($0.sessions),
                     "acknowledged": String($0.acknowledged), "pending": String($0.pending)] as [String: Any]
                })
            } catch { reject("watchtower_failed", error.localizedDescription, nil) }
        }
    }

    @objc(splice:value:resolver:rejecter:)
    func splice(_ action: String, value: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                if action == "confirm" { resolve(try await RegtestNode.shared.splice(token: value)); return }
                guard action == "review", let data = value.data(using: .utf8), data.count <= 1024,
                      let fields = try JSONSerialization.jsonObject(with: data) as? [String: String],
                      let point = fields["point"], let direction = fields["direction"],
                      let sats = fields["sats"].flatMap(UInt64.init), let rate = fields["feeRate"].flatMap(UInt64.init) else {
                    throw NSError(domain: "Splice", code: 1, userInfo: [NSLocalizedDescriptionKey: "Enter a valid channel resize amount and fee rate."])
                }
                resolve(try await RegtestNode.shared.reviewSplice(point: point, direction: direction, sats: sats, feeRate: rate).dictionary)
            } catch SpliceFailure.outcomeUnknown {
                reject("splice_unknown", SpliceFailure.outcomeUnknown.localizedDescription, nil)
            } catch { reject("splice_failed", error.localizedDescription, nil) }
        }
    }

    @objc(wallet:value:resolver:rejecter:)
    func wallet(_ action: String, value: String, resolver resolve: @escaping RCTPromiseResolveBlock,
                rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                if action == "overview" { resolve(try await RegtestNode.shared.walletOverview()); return }
                guard let offset = UInt64(value) else { throw NSError(domain: "Wallet", code: 1) }
                resolve(try await RegtestNode.shared.walletActivity(action, offset: offset))
            } catch { reject("wallet_snapshot_failed", error.localizedDescription, nil) }
        }
    }

    @objc(peer:rejecter:)
    func peer(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do { resolve(try await RegtestNode.shared.savedMainnetPeer()) }
            catch { reject("peer_settings_failed", "Could not read saved XBT peer settings.", nil) }
        }
    }

    @objc(recovery:phrase:source:resolver:rejecter:)
    func recovery(_ operation: String, phrase: String, source: String,
                  resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch operation {
                case "export":
                    let bytes = try await RegtestNode.shared.recoveryFile(phrase: phrase)
                    let file = FileManager.default.temporaryDirectory.appendingPathComponent("RedWallet-mainnet-" + UUID().uuidString + ".rwln")
                    try bytes.write(to: file, options: [.atomic, .completeFileProtection])
                    resolve(file.absoluteString)
                case "restore":
                    let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].resolvingSymlinksInPath()
                    guard let url = URL(string: source), url.isFileURL,
                          url.resolvingSymlinksInPath().path.hasPrefix(caches.path + "/") else {
                        reject("invalid_file", "Choose a local Lightning recovery file.", nil); return
                    }
                    let properties = try url.resourceValues(forKeys: [.isRegularFileKey, .fileSizeKey])
                    guard properties.isRegularFile == true, let size = properties.fileSize, size <= 4 * 1024 * 1024 else {
                        reject("invalid_file", "Invalid Lightning recovery file.", nil); return
                    }
                    try await RegtestNode.shared.restore(file: Data(contentsOf: url), phrase: phrase)
                    resolve("Recovery submitted.")
                default: reject("unknown_action", "Unknown recovery operation.", nil)
                }
            } catch { reject("recovery_failed", "Recovery failed. Check the file, passphrase and node state.", nil) }
        }
    }

    @objc(manage:value:sats:feeRate:resolver:rejecter:)
    func manage(_ operation: String, value: String, sats: String, feeRate: String,
                resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch operation {
                case "channels":
                    let channels = try await RegtestNode.shared.listChannels()
                    resolve(channels.map { ["point": $0.point, "peer": $0.peer, "active": $0.active,
                                           "localSats": String($0.localSats)] as [String: Any] })
                case "channelStatus":
                    let channels = try await RegtestNode.shared.channelStatus()
                    resolve(channels.map { channel -> [String: Any] in
                        var item: [String: Any] = [
                            "point": channel.point, "peer": channel.peer, "state": channel.state,
                            "active": channel.state == "active", "localSats": String(channel.localSats)]
                        item["peerAlias"] = channel.peerAlias
                        item["peerAddress"] = channel.peerAddress
                        item["originalPoint"] = channel.originalPoint
                        if let splice = channel.splice {
                            var state: [String: Any] = ["status": splice.status, "progress": splice.progress, "txid": splice.txid,
                                                       "confirmations": String(splice.confirmations), "lockDepth": String(splice.lockDepth)]
                            if let count = splice.onchainConfirmations { state["onchainConfirmations"] = String(count) }
                            if let locked = splice.weLocked { state["weLocked"] = locked }
                            if let locked = splice.peerLocked { state["peerLocked"] = locked }
                            item["splice"] = state
                        }
                        if let remaining = channel.confirmationsRemaining {
                            item["confirmationsRemaining"] = remaining
                        }
                        return item
                    })
                case "withdrawReview":
                    let review = try await RegtestNode.shared.reviewWithdrawal(address: value, sats: UInt64(sats) ?? 0,
                                                                              feeRate: UInt64(feeRate) ?? 0)
                    resolve(["token": review.token, "address": review.address, "sats": String(review.sats),
                             "feeRate": String(review.feeRate)])
                case "withdraw":
                    resolve(try await RegtestNode.shared.withdraw(token: value))
                case "close":
                    resolve(try await RegtestNode.shared.closeChannel(point: value, feeRate: UInt64(feeRate) ?? 0))
                case "history":
                    resolve(try await RegtestNode.shared.onchainHistory())
                default: reject("unknown_action", "Unknown node management operation.", nil)
                }
            } catch { reject("management_failed", error.localizedDescription, nil) }
        }
    }

    @objc(payInvoice:hash:sats:feeLimit:resolver:rejecter:)
    func payInvoice(_ invoice: String, hash: String, sats: String, feeLimit: String,
                    resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                guard let amount = UInt64(sats), let fee = UInt64(feeLimit) else { throw PaymentSubmissionFailure.invalidReview }
                resolve(try await RegtestNode.shared.pay(invoice: invoice, expectedHash: hash, expectedSats: amount, feeLimit: fee))
            } catch let error as PaymentSubmissionFailure { reject(error.code, error.localizedDescription, nil) }
            catch { reject("invoice_error", error.localizedDescription, nil) }
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
                    resolve(try await RegtestNode.shared.openChannel(to: value, sats: UInt64(sats) ?? 0, feeRate: hash.isEmpty ? 1 : (UInt64(hash) ?? 0)))
                case "receive":
                    let invoice = try await RegtestNode.shared.receive(sats: UInt64(sats) ?? 0)
                    resolve(invoice)
                case "cancel":
                    try await RegtestNode.shared.cancelInvoice(hash: hash)
                    resolve(true)
                case "decode":
                    let info = try await RegtestNode.shared.decode(value)
                    resolve(["sats": String(info.sats), "destination": info.destination, "hash": info.hash])
                case "pay":
                    let settled = try await RegtestNode.shared.pay(invoice: value, expectedHash: hash, expectedSats: UInt64(sats) ?? 0)
                    resolve(settled)
                default: reject("unknown_action", "Unknown invoice operation.", nil)
                }
            } catch let error as PaymentSubmissionFailure { reject(error.code, error.localizedDescription, nil) }
            catch { reject("invoice_error", error.localizedDescription, nil) }
        }
    }

    @objc(run:peer:resolver:rejecter:)
    func run(_ action: String, peer: String, resolver resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
        Task {
            do {
                switch action {
                case "start":
                    try await RegtestNode.shared.startSelectedMainnet(peer: peer)
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
                    let folder = FileManager.default.temporaryDirectory.appendingPathComponent("xbt-mainnet-channel-backup", isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    let file = folder.appendingPathComponent("channel.backup")
                    try backup.write(to: file, options: [.atomic, .completeFileProtection])
                    resolve(file.absoluteString)
                    return
                case "progress":
                    resolve(await RegtestNode.shared.syncProgress())
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
