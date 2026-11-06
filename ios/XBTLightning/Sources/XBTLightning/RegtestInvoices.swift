import Foundation
import Lndmobile

extension ProtoFields {
    static func field(_ number: UInt64, integer value: UInt64) -> Data {
        integer(number << 3) + integer(value)
    }

    func string(_ number: UInt64) throws -> String {
        guard let value = bytes[number]?.first,
              let text = String(data: value, encoding: .utf8), !text.isEmpty else { throw NodeFailure.invalidReply }
        return text
    }
}

extension RegtestNode {
    static func cancelInvoiceRequest(hash: String) throws -> Data {
        let bytes = Array(hash.utf8)
        guard bytes.count == 64, bytes.allSatisfy({
            (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0)
        }) else { throw NodeFailure.invalidReply }
        var decoded = Data()
        for index in stride(from: 0, to: bytes.count, by: 2) {
            guard let byte = UInt8(String(decoding: bytes[index...index + 1], as: UTF8.self), radix: 16) else {
                throw NodeFailure.invalidReply
            }
            decoded.append(byte)
        }
        return ProtoFields.field(1, data: decoded)
    }

    public func cancelInvoice(hash: String) async throws {
        let request = try Self.cancelInvoiceRequest(hash: hash)
        // LND owns the settlement race: already-canceled succeeds; settled fails.
        _ = try await rpc { LndmobileInvoicesCancelInvoice(request, $0) }
    }

    public func receive(sats: UInt64) async throws -> String {
        try await requireSynced()
        guard (1...1_000_000).contains(sats) else { throw NodeFailure.invalidAmount }
        let request = ProtoFields.field(5, integer: sats) + ProtoFields.field(11, integer: 3600) + ProtoFields.field(15, integer: 1)
        let reply = try ProtoFields(await rpc { LndmobileAddInvoice(request, $0) })
        let invoice = try reply.string(2)
        guard invoice.hasPrefix(invoicePrefix) && (!mainnet || !invoice.hasPrefix("lnbcrt")) else { throw NodeFailure.invalidReply }
        return invoice
    }

    public func decode(_ invoice: String) async throws -> (sats: UInt64, destination: String, hash: String) {
        guard invoice.hasPrefix(invoicePrefix) && (!mainnet || !invoice.hasPrefix("lnbcrt")), invoice.utf8.count <= 8192 else { throw NodeFailure.invalidReply }
        let request = ProtoFields.field(1, data: Data(invoice.utf8))
        let reply = try ProtoFields(await rpc { LndmobileDecodePayReq(request, $0) })
        let featureBits = try (reply.bytes[13] ?? []).map { try ProtoFields($0).integers[1] }
        guard featureBits.contains(512) || featureBits.contains(513) else { throw NodeFailure.invalidReply }
        guard let sats = reply.integers[3], (1...1_000_000).contains(sats),
              reply.integers[12] == sats * 1000 else { throw NodeFailure.invalidAmount }
        return (sats, try reply.string(1), try reply.string(2))
    }

    public func recentPayments() async throws -> String {
        let request = ProtoFields.field(1, integer: 1) + ProtoFields.field(3, integer: 10) + ProtoFields.field(4, integer: 1)
        let reply = try ProtoFields(await rpc { LndmobileListPayments(request, $0) })
        let lines = try (reply.bytes[1] ?? []).map { data -> String in
            let p = try ProtoFields(data)
            let status = [1: "In flight", 2: "Settled", 3: "Failed", 4: "Initiated"][Int(p.integers[10] ?? 0)] ?? "Unknown"
            return "\(p.integers[7] ?? 0) \(units) · " + status + " · " + String(try p.string(1).prefix(12))
        }
        return lines.isEmpty ? (mainnet ? "No outgoing payments." : "No outgoing test payments.") : lines.joined(separator: "\n")
    }

    public func channelBackup() async throws -> Data {
        let snapshot = try ProtoFields(await rpc { LndmobileExportAllChannelBackups(Data(), $0) })
        guard let multi = snapshot.bytes[2]?.first,
              let backup = try ProtoFields(multi).bytes[2]?.first, !backup.isEmpty else { throw NodeFailure.invalidReply }
        return backup
    }
}

private final class PaymentResult: NSObject, LndmobileRecvStreamProtocol {
    private let reply: LndmobileCallbackProtocol
    init(_ reply: LndmobileCallbackProtocol) { self.reply = reply }
    func onError(_ error: Error?) { reply.onError(error ?? NodeFailure.invalidReply) }
    func onResponse(_ response: Data?) {
        do {
            let fields = try ProtoFields(response ?? Data())
            switch fields.integers[10] {
            case 2, 3: reply.onResponse(response)
            default: break // The router still owns the pending attempt.
            }
        } catch { reply.onError(error) }
    }
}

extension RegtestNode {
    // Bind the confirmation to the invoice the user actually reviewed.
    public func pay(invoice: String, expectedHash: String, expectedSats: UInt64) async throws -> Bool {
        try await requireSynced()
        let decoded = try await decode(invoice)
        guard decoded.hash == expectedHash, decoded.sats == expectedSats else { throw NodeFailure.invalidReply }
        let request = ProtoFields.field(5, data: Data(invoice.utf8)) + ProtoFields.field(6, integer: 30) + ProtoFields.field(7, integer: 10)
        let result = try ProtoFields(await rpc { LndmobileRouterSendPaymentV2(request, PaymentResult($0)) })
        guard try result.string(1) == expectedHash else { throw NodeFailure.invalidReply }
        return result.integers[10] == 2
    }
}
