import XCTest
@testable import XBTLightning

final class LightningOffersTests: XCTestCase {
    private let offerID = Data(repeating: 7, count: 32)
    private func response(amount: UInt64 = 500_000, signed: Bool = true, offerID: Data? = nil) -> Data {
        let invoice = ProtoFields.field(1, data: Data(repeating: 8, count: 32)) +
            ProtoFields.field(2, integer: amount) +
            ProtoFields.field(3, data: Data([2] + Array(repeating: 9, count: 32))) +
            ProtoFields.field(4, integer: 2_000_000_000) +
            ProtoFields.field(6, integer: 1) +
            ProtoFields.field(8, integer: signed ? 1 : 0)
        return ProtoFields.field(1, data: Data("lni1qpz".utf8)) +
            ProtoFields.field(2, data: invoice) + ProtoFields.field(3, data: offerID ?? self.offerID)
    }
    private func intent() throws -> Bolt12Intent {
        try Bolt12Intent.fetched(response(), offer: "lno1qpz", requestedSats: 500, offerID: offerID, expectedSats: 500)
    }
    func testFetchedInvoiceBindsAmountOfferSignatureAndExpiry() throws {
        let invoice = try intent()
        XCTAssertEqual(invoice.sats, 500)
        XCTAssertEqual(invoice.expires, 2_000_007_200)
        XCTAssertFalse(invoice.submitted)
        for data in [response(amount: 501_000), response(amount: 500_001),
                     response(signed: false), response(offerID: Data(repeating: 6, count: 32))] {
            XCTAssertThrowsError(try Bolt12Intent.fetched(data, offer: "lno1qpz", requestedSats: 500,
                                                        offerID: offerID, expectedSats: 500))
        }
    }
    func testReviewExpiresAndCannotAuthorizeAfterClockMovesBackwards() throws {
        let start = Date(timeIntervalSince1970: 2_000_000_001)
        let review = Bolt12Review(token: "token", intent: try intent(), feeSats: 10, created: start)
        XCTAssertTrue(review.valid(now: start.addingTimeInterval(299)))
        XCTAssertFalse(review.valid(now: start.addingTimeInterval(300)))
        XCTAssertFalse(review.valid(now: start.addingTimeInterval(-1)))
    }
    func testJournalSurvivesRestartAndCorruptionNeverLooksEmpty() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        let url = folder.appendingPathComponent("payment.json")
        let journal = Bolt12Journal(url: url)
        XCTAssertNil(try journal.load())
        var saved = try intent()
        try journal.save(saved)
        XCTAssertEqual(try Bolt12Journal(url: url).load(), saved)
        saved.submitted = true
        try journal.save(saved)
        XCTAssertEqual(try Bolt12Journal(url: url).load()?.submitted, true)
        try Data("broken".utf8).write(to: url)
        XCTAssertThrowsError(try journal.load())
        try journal.clear()
        XCTAssertNil(try journal.load())
    }
    func testOfferNormalizationRejectsMixedCaseAndOtherMessageTypes() throws {
        XCTAssertEqual(try RegtestNode.normalizedOffer(" LIGHTNING:LNO1QPZ "), "lno1qpz")
        for value in ["lno1Qpz", "lni1qpz", "lnr1qpz", "lno1" + String(repeating: "q", count: 32768)] {
            XCTAssertThrowsError(try RegtestNode.normalizedOffer(value))
        }
    }
}
