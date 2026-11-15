import XCTest
@testable import XBTLightning

private actor FakeDirectoryStream: JoinBlaketLineConnection {
    var opens = 0
    var closes = 0
    var writes: [String] = []
    func open() async throws { opens += 1 }
    func readLine() async throws -> String? { "test\r" }
    func writeLine(_ line: String) async throws { writes.append(line) }
    func close() async { closes += 1 }
}

private actor DirectoryStartGate {
    private var waiting: CheckedContinuation<UInt16, Never>?
    private let entered: XCTestExpectation
    init(_ entered: XCTestExpectation) { self.entered = entered }
    func start() async -> UInt16 {
        await withCheckedContinuation { continuation in
            waiting = continuation; entered.fulfill()
        }
    }
    func release() { waiting?.resume(returning: 19050); waiting = nil }
}

final class JoinBlaketTransportTests: XCTestCase {
    func testSplitUTF8AndCoalescedCRLFLines() throws {
        var buffer = JoinBlaketLineBuffer()
        try buffer.append(Data([0xe2, 0x82]))
        XCTAssertNil(try buffer.next())
        try buffer.append(Data([0xac, 13, 10]) + Data("next\r\n".utf8))
        XCTAssertEqual(try buffer.next(), "€\r")
        XCTAssertEqual(try buffer.next(), "next\r")
        XCTAssertNil(try buffer.next())
    }

    func testByteBoundAndMalformedUTF8() throws {
        var buffer = JoinBlaketLineBuffer()
        try buffer.append(Data(repeating: 65, count: JoinBlaketLineBuffer.limit - 1))
        XCTAssertNil(try buffer.next())
        try buffer.append(Data([10]))
        XCTAssertEqual(try buffer.next()?.utf8.count, JoinBlaketLineBuffer.limit - 1)
        var full = JoinBlaketLineBuffer()
        try full.append(Data(repeating: 65, count: JoinBlaketLineBuffer.limit))
        XCTAssertThrowsError(try full.next())
        XCTAssertThrowsError(try full.append(Data([10])))
        var invalid = JoinBlaketLineBuffer()
        try invalid.append(Data([0xc0, 0xaf, 10]))
        XCTAssertThrowsError(try invalid.next())
    }

    func testOnlyBoundedSingleCRLFWrite() throws {
        XCTAssertEqual(try JoinBlaketLineBuffer.outgoing("hello\r"), Data("hello\r\n".utf8))
        for bad in ["", "hello", "hello\n", "a\r\nb\r", "a\rb\r", String(repeating: "é", count: 32768) + "\r"] {
            XCTAssertThrowsError(try JoinBlaketLineBuffer.outgoing(bad))
        }
    }

    func testCloseBeforeOpenCannotResurrectAHandle() async throws {
        let fake = FakeDirectoryStream()
        let transport = JoinBlaketTransport(startTor: { 19050 }, makeStream: { _ in fake }, isForeground: { true })
        let id = String(repeating: "a", count: 32)
        await transport.close(id)
        do { try await transport.open(id); XCTFail("retired handle opened") } catch {}
        let opens = await fake.opens
        XCTAssertEqual(opens, 0)
    }

    func testAbortDuringTorBootstrapDoesNotOpenLateStream() async throws {
        let entered = expectation(description: "bootstrap")
        let gate = DirectoryStartGate(entered)
        let fake = FakeDirectoryStream()
        let transport = JoinBlaketTransport(startTor: { await gate.start() }, makeStream: { _ in fake }, isForeground: { true })
        let id = String(repeating: "b", count: 32)
        let opening = Task { try await transport.open(id) }
        await fulfillment(of: [entered], timeout: 2)
        await transport.close(id)
        await gate.release()
        do { try await opening.value; XCTFail("cancelled opening succeeded") } catch {}
        let opens = await fake.opens
        XCTAssertEqual(opens, 0)
    }

    func testOneStreamAndStaleCloseDoesNotCloseNewStream() async throws {
        let fake = FakeDirectoryStream()
        let transport = JoinBlaketTransport(startTor: { 19050 }, makeStream: { _ in fake }, isForeground: { true })
        let first = String(repeating: "c", count: 32), second = String(repeating: "d", count: 32)
        try await transport.open(first)
        do { try await transport.open(second); XCTFail("two active streams") } catch {}
        await transport.close(first)
        try await transport.open(second)
        await transport.close(first)
        let line = try await transport.readLine(second)
        XCTAssertEqual(line, "test\r")
        await transport.closeAll()
        do { _ = try await transport.readLine(second); XCTFail("read after close") } catch {}
        let closes = await fake.closes
        XCTAssertEqual(closes, 2)
    }

    func testBackgroundAndMalformedHandleCannotStartTor() async throws {
        let transport = JoinBlaketTransport(startTor: { XCTFail("started Tor"); return 19050 },
                                           makeStream: { _ in FakeDirectoryStream() }, isForeground: { false })
        do { try await transport.open(String(repeating: "e", count: 32)); XCTFail("background open") } catch {}
        do { try await transport.open("../bad"); XCTFail("invalid handle") } catch {}
    }
}
