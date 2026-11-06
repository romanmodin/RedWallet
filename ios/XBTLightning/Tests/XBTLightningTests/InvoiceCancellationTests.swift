import XCTest
@testable import XBTLightning

final class InvoiceCancellationTests: XCTestCase {
    func testCancelEncodesRawHashInFieldOne() throws {
        let request = try RegtestNode.cancelInvoiceRequest(hash: String(repeating: "aB", count: 32))
        XCTAssertEqual(try ProtoFields(request).bytes[1]?.first, Data(repeating: 0xab, count: 32))
    }

    func testRejectsMalformedHashes() {
        for hash in ["", "00", String(repeating: "g", count: 64), String(repeating: "a", count: 63), String(repeating: "a", count: 65)] {
            XCTAssertThrowsError(try RegtestNode.cancelInvoiceRequest(hash: hash))
        }
    }
}
