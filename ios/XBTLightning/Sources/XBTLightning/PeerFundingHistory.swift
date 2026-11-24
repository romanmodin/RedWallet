import Foundation

// All amounts are contributions to the shared funding output. Payments, the
// opening push, reserves and commitment fees must never be counted as deposits.
struct FundingChange: Codable, Equatable, Sendable {
    var parent: String?
    var peerDelta: Int64?
    var time: UInt64?
    var nodeReceipt = false
}

struct FundingSnapshot: Sendable {
    let original: String
    let point: String
    let capacity: Int64
    let openedByUs: Bool
    var settled: FundingChange?
    var pending: (point: String, change: FundingChange)?

    init?(_ channel: ProtoFields, point: String) {
        guard let original = try? channel.string(1005), !original.isEmpty,
              let amount = channel.integers[5], LightningAmounts.valid(amount) else { return nil }
        self.original = original
        self.point = point
        capacity = Int64(amount)
        openedByUs = channel.integers[18] == 1
        if let bytes = channel.bytes[1004]?.first, let last = try? ProtoFields(bytes),
           (try? last.string(6)) == "locked", let txid = try? last.string(4),
           point.split(separator: ":").first.map(String.init) == txid {
            settled = FundingChange(peerDelta: Int64(bitPattern: last.integers[3] ?? 0), time: last.integers[5], nodeReceipt: true)
        }
        if let bytes = channel.bytes[1003]?.first, let next = try? ProtoFields(bytes),
           let nextPoint = try? next.string(17), let txid = try? next.string(8),
           nextPoint.split(separator: ":").first.map(String.init) == txid, !txid.isEmpty {
            pending = (nextPoint, FundingChange(parent: point, peerDelta: Int64(bitPattern: next.integers[4] ?? 0), nodeReceipt: true))
        }
    }
}

// Index the wallet's own transaction records once per refresh. The current
// channel outpoint anchors the walk; unrelated, failed and replaced attempts
// never enter the history just because their labels mention the channel.
struct FundingTransactions {
    struct Transaction {
        var inputs: [String: Bool] = [:] // exact outpoint -> wallet owns input
        var time: UInt64?
    }
    struct Output {
        let amount: Int64
        let isFundingScript: Bool
    }
    let walletSynced: Bool
    var confirmations: [String: Int64] = [:]
    var transactions: [String: Transaction] = [:]
    var outputs: [String: Output] = [:]

    init(_ data: Data?, walletSynced: Bool = false) {
        self.walletSynced = walletSynced
        guard let data, let fields = try? ProtoFields(data) else { return }
        for bytes in fields.bytes[1] ?? [] {
            guard let tx = try? ProtoFields(bytes), let id = try? tx.string(1) else { continue }
            confirmations[id] = Int64(bitPattern: tx.integers[3] ?? 0)
            var inputs: [String: Bool] = [:]
            let rows = tx.bytes[12] ?? []
            for row in rows {
                guard let input = try? ProtoFields(row), let point = try? input.string(1) else { continue }
                inputs[point] = input.integers[2] == 1
            }
            if inputs.count == rows.count {
                transactions[id] = Transaction(inputs: inputs, time: tx.integers[6])
            }
            for row in tx.bytes[11] ?? [] {
                guard let out = try? ProtoFields(row), let amount = out.integers[5],
                      LightningAmounts.valid(amount) else { continue }
                let point = id + ":" + String(out.integers[4] ?? 0)
                outputs[point] = Output(amount: Int64(amount), isFundingScript: out.integers[1] == 3)
            }
        }
    }

    func change(at point: String, capacity: Int64?, original: String, known: [String: FundingChange]) -> FundingChange? {
        guard let txid = point.split(separator: ":").first, let tx = transactions[String(txid)] else { return nil }
        // The pinned splice engine uses one shared P2WSH input. All other
        // inputs are P2WPKH or P2TR. It permits only the initiator to contribute.
        let parents = tx.inputs.keys.filter { $0 == original || known[$0] != nil || outputs[$0]?.isFundingScript == true }
        guard parents.count == 1, let parent = parents.first else { return nil }
        var result = FundingChange(parent: parent, time: tx.time)
        let owners = tx.inputs.filter { $0.key != parent }.values
        if walletSynced, (confirmations[String(txid)] ?? 0) > 0,
           let amount = capacity ?? outputs[point]?.amount, let before = outputs[parent]?.amount,
           amount > before, let owner = owners.first, owners.allSatisfy({ $0 == owner }) {
            result.peerDelta = owner ? 0 : amount - before
        }
        // A splice-out may have only the shared input. Its payout address does
        // not identify its initiator; use the signed node receipt when available.
        return result
    }
}

public struct PeerFundingHistory: Sendable {
    public let opening: Int64?
    public let complete: Bool
    let changes: [(point: String, change: FundingChange)]

    public var dictionary: [String: Any] {
        var result: [String: Any] = ["complete": complete, "changes": changes.map { entry -> [String: String] in
            var row = ["point": entry.point]
            if let delta = entry.change.peerDelta { row["peerDeltaSats"] = String(delta) }
            if let time = entry.change.time, time > 0 { row["time"] = String(time) }
            return row
        }]
        if let opening { result["openingPeerSats"] = String(opening) }
        return result
    }
}

struct FundingJournal: Codable, Equatable {
    var opening: Int64?
    var locked: [String: FundingChange] = [:]
    var pendingPoint: String?
    var pendingChange: FundingChange?

    mutating func update(_ snapshot: FundingSnapshot, transactions: FundingTransactions) -> PeerFundingHistory {
        // This engine opens single-funded channels. The party that opened it
        // supplied the full original output, including any sats pushed across.
        if snapshot.openedByUs { opening = 0 }
        else if snapshot.original == snapshot.point { opening = snapshot.capacity }
        else if let output = transactions.outputs[snapshot.original] { opening = output.amount }

        if snapshot.point == pendingPoint, let receipt = pendingChange {
            locked[snapshot.point] = receipt
        }
        if let pending = snapshot.pending {
            pendingPoint = pending.point
            pendingChange = pending.change
        } else if pendingPoint == snapshot.point || snapshot.settled != nil {
            pendingPoint = nil
            pendingChange = nil
        }

        var point = snapshot.point
        var seen = Set<String>()
        var changes: [(String, FundingChange)] = []
        var complete = opening != nil
        while point != snapshot.original, seen.insert(point).inserted {
            var receipt = locked[point] ?? FundingChange()
            let chain = transactions.change(at: point, capacity: point == snapshot.point ? snapshot.capacity : nil,
                                            original: snapshot.original, known: locked)
            receipt.parent = chain?.parent ?? receipt.parent
            if let last = snapshot.settled, point == snapshot.point {
                receipt.peerDelta = last.peerDelta
                receipt.time = last.time ?? receipt.time
                receipt.nodeReceipt = true
            } else if !receipt.nodeReceipt, let delta = chain?.peerDelta {
                receipt.peerDelta = delta
            }
            receipt.time = receipt.time ?? chain?.time
            locked[point] = receipt
            changes.append((point, receipt))
            if receipt.peerDelta == nil { complete = false }
            guard let parent = receipt.parent else { break }
            point = parent
        }
        return PeerFundingHistory(opening: opening, complete: complete && point == snapshot.original, changes: changes)
    }
}
