import XCTest
@testable import XBTLightning

final class RegtestTests: XCTestCase {
    func testProtobufBounds() throws {
        let message = ProtoFields.field(2, data: Data("test".utf8))
        XCTAssertEqual(try ProtoFields(message).bytes[2], [Data("test".utf8)])
        XCTAssertThrowsError(try ProtoFields(Data([0x12, 0x7f])))
        XCTAssertThrowsError(try ProtoFields(Data(repeating: 0xff, count: 10)))
    }

    func testEmbeddedNodeStartsAndReportsWalletState() async throws {
        try await RegtestNode.shared.start()
        try await RegtestNode.shared.start()
        let status = try await RegtestNode.shared.status()
        XCTAssertEqual(status, "Needs setup")
    }
}
