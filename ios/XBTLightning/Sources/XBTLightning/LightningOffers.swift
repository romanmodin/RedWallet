import Foundation
import CryptoKit
import Lndmobile

enum Bolt12Failure: String, LocalizedError {
    case invalid = "This is not a supported XBT BOLT12 offer."
    case amount = "Enter a whole-sat amount and a routing fee of at least 1 sat for BOLT12."
    case busy = "Another offer operation is still running."
    case previous = "A previous offer invoice is saved. Resume it, or choose Start new offer payment."
    case unresolved = "The previous payment is unresolved. Check its payment status before starting another."
    case expired = "This offer invoice expired. Choose Start new offer payment to request another."
    case storage = "Could not read or save the offer payment. Nothing new was submitted."
    var errorDescription: String? { rawValue }
}

struct Bolt12Intent: Codable, Equatable {
    let offer: String
    let requestedSats: UInt64
    let invoice: String
    let hash: String
    let sats: UInt64
    let destination: String
    let expires: UInt64
    var submitted: Bool

    static func fetched(_ data: Data, offer: String, requestedSats: UInt64,
                        offerID: Data, expectedSats: UInt64) throws -> Self {
        let result = try ProtoFields(data)
        guard result.bytes[3]?.first == offerID, offerID.count == 32,
              let infoData = result.bytes[2]?.first else { throw Bolt12Failure.invalid }
        let info = try ProtoFields(infoData)
        let invoice = try result.string(1)
        let msat = info.integers[2] ?? 0
        let created = info.integers[4] ?? 0
        // BOLT12's omitted relative expiry is 7200 seconds.
        let lifetime = info.integers[5] ?? 7200
        guard invoice.hasPrefix("lni1"), invoice.utf8.count <= 32768,
              let hash = info.bytes[1]?.first, hash.count == 32,
              let node = info.bytes[3]?.first, node.count == 33,
              info.integers[8] == 1, (info.integers[6] ?? 0) > 0,
              msat % 1000 == 0, LightningAmounts.valid(msat / 1000),
              msat / 1000 == expectedSats, created > 0, lifetime > 0,
              created <= UInt64.max - lifetime else { throw Bolt12Failure.invalid }
        return Self(offer: offer, requestedSats: requestedSats, invoice: invoice,
                    hash: hash.hex, sats: msat / 1000, destination: node.hex,
                    expires: created + lifetime, submitted: false)
    }


    func validateDecoded(_ data: Data) throws {
        let decoded = try ProtoFields(data)
        guard try decoded.string(1) == "invoice", decoded.integers[2] == 1,
              let raw = decoded.bytes[7]?.first else { throw Bolt12Failure.invalid }
        let info = try ProtoFields(raw)
        let created = info.integers[4] ?? 0
        let lifetime = info.integers[5] ?? 7200
        guard info.integers[8] == 1,
              info.bytes[1]?.first?.hex == hash, info.bytes[3]?.first?.hex == destination,
              info.integers[2] == sats * 1000,
              created <= UInt64.max - lifetime, created + lifetime == expires else {
            throw Bolt12Failure.invalid
        }
    }

    func validate() throws {
        guard offer.hasPrefix("lno1"), offer.utf8.count <= 32768,
              invoice.hasPrefix("lni1"), invoice.utf8.count <= 32768,
              hash.count == 64, hash.allSatisfy({ $0.isHexDigit }),
              destination.count == 66, destination.allSatisfy({ $0.isHexDigit }),
              LightningAmounts.valid(sats), LightningAmounts.valid(requestedSats, allowZero: true),
              expires > 0 else { throw Bolt12Failure.storage }
    }
}

// Store the fetched invoice before it can be paid, and the submission marker
// before calling LND. A restart/error must never fetch a second invoice silently.
struct Bolt12Journal {
    let url: URL
    func load() throws -> Bolt12Intent? {
        guard FileManager.default.fileExists(atPath: url.path) else { return nil }
        do {
            let data = try Data(contentsOf: url)
            guard data.count <= 100_000 else { throw Bolt12Failure.storage }
            let intent = try JSONDecoder().decode(Bolt12Intent.self, from: data)
            try intent.validate()
            return intent
        } catch { throw Bolt12Failure.storage }
    }
    func save(_ intent: Bolt12Intent) throws {
        do {
            try intent.validate()
            try JSONEncoder().encode(intent).write(to: url, options: [.atomic, .completeUntilFirstUserAuthentication])
        } catch { throw Bolt12Failure.storage }
    }
    func clear() throws {
        do {
            if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) }
        } catch { throw Bolt12Failure.storage }
    }
}

struct Bolt12Review {
    let token: String
    let intent: Bolt12Intent
    let feeSats: UInt64
    let created: Date
    var dictionary: [String: Any] {
        ["bolt12Token": token, "invoice": intent.invoice, "hash": intent.hash,
         "sats": String(intent.sats), "destination": intent.destination, "feeLimit": String(feeSats)]
    }
    func valid(now: Date) -> Bool {
        let age = now.timeIntervalSince(created)
        return age >= 0 && age < 300 && now.timeIntervalSince1970 < Double(intent.expires)
    }
}

private extension Data {
    var hex: String { map { String(format: "%02x", $0) }.joined() }
}

extension RegtestNode {
    private func offerJournal() throws -> Bolt12Journal {
        let root = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask,
                                               appropriateFor: nil, create: false)
        let folder = root.appendingPathComponent(mainnet ? MainnetConfiguration.directoryName : "XBTLightning-regtest")
        return Bolt12Journal(url: folder.appendingPathComponent("bolt12-payment.json"))
    }

    static func normalizedOffer(_ value: String) throws -> String {
        var text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.lowercased().hasPrefix("lightning:") { text = String(text.dropFirst(10)) }
        guard text.utf8.count <= 32768,
              text == text.lowercased() || text == text.uppercased() else { throw Bolt12Failure.invalid }
        // The native decoder also checks the TLV encoding, chain and features.
        text = text.lowercased()
        guard text.hasPrefix("lno1") else { throw Bolt12Failure.invalid }
        return text
    }

    static func offerDictionary(_ data: Data) throws -> [String: Any] {
        let fields = try ProtoFields(data)
        let text = try fields.string(2)
        let amount = fields.integers[4] ?? 0
        guard let id = fields.bytes[1]?.first, id.count == 32,
              text.hasPrefix("lno1"), text.utf8.count <= 32768,
              amount % 1000 == 0, LightningAmounts.valid(amount / 1000, allowZero: true) else { throw Bolt12Failure.invalid }
        return ["id": id.hex, "offer": text, "sats": String(amount / 1000),
                "description": String(decoding: fields.bytes[3]?.first ?? Data(), as: UTF8.self),
                "active": fields.integers[7] == 1, "expires": String(fields.integers[5] ?? 0)]
    }

    public func createOffer(description: String, sats: UInt64) async throws -> [String: Any] {
        try await requireSynced()
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !description.isEmpty, description.utf8.count <= 256,
              LightningAmounts.valid(sats, allowZero: true) else { throw Bolt12Failure.amount }
        let request = ProtoFields.field(1, data: Data(description.utf8)) +
            ProtoFields.field(2, integer: sats * 1000) + ProtoFields.field(7, integer: 1)
        let response = try ProtoFields(await rpc { LndmobileOffersCreateOffer(request, $0) })
        guard let offer = response.bytes[1]?.first else { throw Bolt12Failure.invalid }
        return try Self.offerDictionary(offer)
    }

    public func listOffers() async throws -> [[String: Any]] {
        let response = try ProtoFields(await rpc { LndmobileOffersListOffers(Data(), $0) })
        let offers = response.bytes[1] ?? []
        guard offers.count <= 500 else { throw Bolt12Failure.invalid }
        return try offers.map(Self.offerDictionary)
    }

    public func setOfferEnabled(id: String, enabled: Bool) async throws {
        let request = try Self.cancelInvoiceRequest(hash: id) // same bytes field 1
        _ = try await rpc {
            if enabled { LndmobileOffersEnableOffer(request, $0) }
            else { LndmobileOffersDisableOffer(request, $0) }
        }
    }

    public func reviewOffer(_ value: String, sats: UInt64, feeSats: UInt64) async throws -> [String: Any] {
        guard !offerOperationBusy else { throw Bolt12Failure.busy }
        offerOperationBusy = true
        defer { offerOperationBusy = false }
        offerReview = nil
        guard LightningAmounts.valid(sats, allowZero: true), LightningAmounts.valid(feeSats) else { throw Bolt12Failure.amount }
        try await requireSynced()
        let offer = try Self.normalizedOffer(value)
        let journal = try offerJournal()
        let intent: Bolt12Intent
        if let previous = try journal.load() {
            guard previous.offer == offer, previous.requestedSats == sats else { throw Bolt12Failure.previous }
            intent = previous
        } else {
            let decoded = try ProtoFields(await rpc {
                LndmobileOffersDecodeBolt12(ProtoFields.field(1, data: Data(offer.utf8)), $0)
            })
            guard try decoded.string(1) == "offer", decoded.integers[2] == 1, decoded.integers[8] == 1,
                  let id = decoded.bytes[4]?.first, id.count == 32,
                  let offerFields = decoded.bytes[5]?.first else { throw Bolt12Failure.invalid }
            let fields = try ProtoFields(offerFields)
            // Quantities need their own review UI; never silently assume one.
            guard fields.integers[14] == nil, fields.integers[15] != 1 else { throw Bolt12Failure.invalid }
            let minimumMsat = fields.integers[4] ?? 0
            guard minimumMsat % 1000 == 0 else { throw Bolt12Failure.amount }
            let expected = sats == 0 ? minimumMsat / 1000 : sats
            guard LightningAmounts.valid(expected), expected * 1000 >= minimumMsat else { throw Bolt12Failure.amount }
            let request = ProtoFields.field(1, data: Data(offer.utf8)) +
                ProtoFields.field(2, integer: expected * 1000) + ProtoFields.field(5, integer: 25)
            let fetched = try await rpc { LndmobileOffersFetchInvoice(request, $0) }
            intent = try Bolt12Intent.fetched(fetched, offer: offer, requestedSats: sats, offerID: id, expectedSats: expected)
            try journal.save(intent)
        }
        let invoiceData = try await rpc {
            LndmobileOffersDecodeBolt12(ProtoFields.field(1, data: Data(intent.invoice.utf8)), $0)
        }
        try intent.validateDecoded(invoiceData)
        // Let an already submitted expired invoice still be inspected in history,
        // but do not issue a spend authorization for it.
        guard Date().timeIntervalSince1970 < Double(intent.expires) else { throw Bolt12Failure.expired }
        let review = Bolt12Review(token: UUID().uuidString, intent: intent, feeSats: feeSats, created: Date())
        offerReview = review
        return review.dictionary
    }

    private func offerPaymentState(hash: String) async throws -> String {
        var offset: UInt64 = 0
        var visited = Set<UInt64>()
        for _ in 0..<200 {
            guard visited.insert(offset).inserted else { throw Bolt12Failure.unresolved }
            let page = try await walletActivity("payments", offset: offset)
            guard let rows = page["rows"] as? [[String: Any]], let more = page["more"] as? Bool else {
                throw Bolt12Failure.unresolved
            }
            if let row = rows.first(where: { ($0["id"] as? String)?.lowercased() == hash }) {
                return row["state"] as? String ?? "unknown"
            }
            if !more { return "not_found" }
            guard let text = page["next"] as? String, let next = UInt64(text), next > 0,
                  offset == 0 || next < offset else { throw Bolt12Failure.unresolved }
            offset = next
        }
        throw Bolt12Failure.unresolved
    }

    public func savedOfferPayment() throws -> [String: Any]? {
        guard let intent = try offerJournal().load() else { return nil }
        return ["offer": intent.offer, "requestedSats": String(intent.requestedSats),
                "hash": intent.hash, "sats": String(intent.sats)]
    }

    public func resetOfferPayment() async throws {
        guard !offerOperationBusy else { throw Bolt12Failure.busy }
        offerOperationBusy = true
        defer { offerOperationBusy = false }
        let journal = try offerJournal()
        if let intent = try journal.load(), intent.submitted {
            let state = try await offerPaymentState(hash: intent.hash)
            guard state == "settled" || state == "failed" else { throw Bolt12Failure.unresolved }
        }
        try journal.clear()
        offerReview = nil
    }

    public func payOffer(token: String) async throws -> Bool {
        guard !offerOperationBusy else { throw PaymentSubmissionFailure.unavailable }
        offerOperationBusy = true
        defer { offerOperationBusy = false }
        guard let review = offerReview, review.token == token, review.valid(now: Date()) else {
            throw PaymentSubmissionFailure.invalidReview
        }
        offerReview = nil // consume before any suspension point
        do { try await requireSynced() }
        catch { throw PaymentSubmissionFailure.notSynced }
        let journal = try offerJournal()
        guard var intent = try journal.load(), intent == review.intent else { throw PaymentSubmissionFailure.invalidReview }
        let state = try await offerPaymentState(hash: intent.hash)
        if state == "settled" { return true }
        guard state == "failed" || (state == "not_found" && !intent.submitted) else { throw Bolt12Failure.unresolved }
        // Recheck persisted metadata against the signed invoice before spending.
        // A valid JSON file with a corrupted amount must not understate the review.
        let invoiceData = try await rpc {
            LndmobileOffersDecodeBolt12(ProtoFields.field(1, data: Data(intent.invoice.utf8)), $0)
        }
        try intent.validateDecoded(invoiceData)
        guard review.valid(now: Date()) else { throw PaymentSubmissionFailure.invalidReview }
        // No offer field: payment can only use the exact fetched/reviewed invoice.
        let request = ProtoFields.field(2, data: Data(intent.invoice.utf8)) +
            ProtoFields.field(6, integer: 30) + ProtoFields.field(7, integer: review.feeSats * 1000)
        intent.submitted = true
        try journal.save(intent)
        // All errors after this boundary are ambiguous until LND history resolves.
        let result = try ProtoFields(await rpc { LndmobileOffersPayOffer(request, $0) })
        guard try result.string(1) == intent.invoice,
              result.bytes[2]?.first?.hex == intent.hash,
              result.integers[4] == intent.sats * 1000,
              (result.integers[5] ?? 0) <= review.feeSats * 1000,
              let preimage = result.bytes[3]?.first, preimage.count == 32,
              Data(SHA256.hash(data: preimage)).hex == intent.hash else { throw NodeFailure.invalidReply }
        return true
    }
}
