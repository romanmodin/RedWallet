import Foundation
import XCTest
@testable import SeparationHTTP

private final class ProofProtocol: URLProtocol {
    static var handler: ((ProofProtocol) -> Void)?
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { Self.handler?(self) }
    override func stopLoading() {}
    func reply(_ bytes: Data, status: Int = 200, headers: [String: String] = [:], at url: URL? = nil, finish: Bool = true) {
        var fields = ["Date": "Wed, 18 May 2033 03:33:20 GMT"]
        fields.merge(headers) { _, new in new }
        let response = HTTPURLResponse(url: url ?? request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: fields)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: bytes)
        if finish { client?.urlProtocolDidFinishLoading(self) }
    }
}

final class SeparationHTTPTests: XCTestCase {
    private let base = SeparationHTTPTransport.evidenceBase
    private let fixtureHash = String(repeating: "ab", count: 32)
    private var transport: SeparationHTTPTransport!
    private var url: String { base + "/blocks/tip/height" }
    override func setUp() {
        let config = SeparationHTTPTransport.configuration()
        config.protocolClasses = [ProofProtocol.self]
        transport = SeparationHTTPTransport(configuration: config)
    }
    override func tearDown() { transport.invalidate(); transport = nil; ProofProtocol.handler = nil }
    private func fetch(_ limit: Int = 160, id: String = UUID().uuidString) async throws -> SeparationHTTPResult {
        try await withCheckedThrowingContinuation { continuation in
            transport.get(id: id, url: url, limit: limit) { continuation.resume(with: $0) }
        }
    }
    func testRequestPolicyAndNoCredentialsOrCookieStores() throws {
        let config = SeparationHTTPTransport.configuration()
        XCTAssertNil(config.urlCache); XCTAssertNil(config.httpCookieStorage); XCTAssertNil(config.urlCredentialStorage)
        XCTAssertFalse(config.httpShouldSetCookies); XCTAssertEqual(config.httpCookieAcceptPolicy, .never)
        XCTAssertEqual(config.timeoutIntervalForResource, 8)
        let request = try SeparationHTTPTransport.request(url: url, limit: 160)
        XCTAssertEqual(request.httpMethod, "GET"); XCTAssertNil(request.httpBody)
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization")); XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertTrue(request.value(forHTTPHeaderField: "Cache-Control")!.contains("no-store"))
    }
    func testCanonicalAllowlistAndPerPathLimits() throws {
        XCTAssertEqual(try SeparationHTTPTransport.bodyLimit(for: base + "/tx/" + fixtureHash + "/hex"), 2_000_000)
        XCTAssertEqual(try SeparationHTTPTransport.bodyLimit(for: base + "/block/" + fixtureHash + "/header"), 160)
        XCTAssertEqual(try SeparationHTTPTransport.bodyLimit(for: base + "/tx/" + fixtureHash + "/outspend/4294967295"), 16384)
        let invalid: [String] = [
            url + "?x=1", url + "#x", url + "\n", url + "/", base + "/address/bc1qtest",
            "http://blockstream.info/api/blocks/tip/height", "https://blockstream.info:443/api/blocks/tip/height",
            "https://user@blockstream.info/api/blocks/tip/height", "https://blockstream.info.evil.example/api/blocks/tip/height",
            "https://127.0.0.1/api/blocks/tip/height", base + "/tx/" + fixtureHash + "/%68ex",
            base + "/tx/" + fixtureHash + "/outspend/4294967296", base + "/tx/" + fixtureHash + "/outspend/01",
            SeparationHTTPTransport.anchorBase + "/tx/" + fixtureHash + "/hex"
        ]
        for value in invalid { XCTAssertThrowsError(try SeparationHTTPTransport.request(url: value, limit: 160), value) }
        XCTAssertThrowsError(try SeparationHTTPTransport.request(url: base + "/block/" + fixtureHash + "/header", limit: 161))
    }
    func testSuccessfulRequestReturnsOnlyExpectedURLAndBoundedUTF8Body() async throws {
        ProofProtocol.handler = { $0.reply(Data("976100".utf8)) }
        let result = try await fetch()
        XCTAssertEqual(result.url, url); XCTAssertEqual(result.body, "976100"); XCTAssertEqual(result.serverTime, 2_000_000_000)
    }
    func testRejectsInvalidServerDate() async {
        ProofProtocol.handler = { $0.reply(Data("976100".utf8), headers: ["Date": "invalid"]) }
        do { _ = try await fetch(); XCTFail("accepted invalid server date") } catch {}
    }
    func testRejectsNon200Response() async {
        ProofProtocol.handler = { $0.reply(Data("unavailable".utf8), status: 503) }
        do { _ = try await fetch(); XCTFail("accepted error response") } catch {}
    }
    func testRejectsChangedResponseURL() async {
        ProofProtocol.handler = { $0.reply(Data("976100".utf8), at: URL(string: "https://mempool.space/api/blocks/tip/height")) }
        do { _ = try await fetch(); XCTFail("accepted changed URL") } catch {}
    }
    func testRejectsOversizedContentLengthBeforeBody() async {
        ProofProtocol.handler = { $0.reply(Data(), headers: ["Content-Length": "161"]) }
        do { _ = try await fetch(); XCTFail("accepted oversized response") } catch {}
    }
    func testRejectsChunkedOverflowAndInvalidUTF8() async {
        ProofProtocol.handler = { protocolInstance in
            protocolInstance.reply(Data(repeating: 97, count: 100), finish: false)
            protocolInstance.client?.urlProtocol(protocolInstance, didLoad: Data(repeating: 98, count: 100))
            protocolInstance.client?.urlProtocolDidFinishLoading(protocolInstance)
        }
        do { _ = try await fetch(); XCTFail("accepted chunk overflow") } catch {}
        ProofProtocol.handler = { $0.reply(Data([0xff, 0xff])) }
        do { _ = try await fetch(); XCTFail("accepted invalid UTF8") } catch {}
    }
    func testRedirectDelegateRefusesEveryTarget() {
        // Real TLS non-follow is tested by the simulator's disclosure-probe counter.
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: URL(string: url)!)
        for target in [url, "https://example.com/", "http://blockstream.info/"] {
            let response = HTTPURLResponse(url: URL(string: url)!, statusCode: 302, httpVersion: nil,
                                           headerFields: ["Location": target])!
            var refused = false
            transport.urlSession(session, task: task, willPerformHTTPRedirection: response,
                newRequest: URLRequest(url: URL(string: target)!)) { refused = $0 == nil }
            XCTAssertTrue(refused)
        }
    }
    func testCancellationReleasesCapacityAndCompletesExactlyOnce() async throws {
        ProofProtocol.handler = { _ in }
        let canceled = expectation(description: "canceled")
        canceled.assertForOverFulfill = true
        transport.get(id: "cancel", url: url, limit: 160) { result in
            if case .success = result { XCTFail("accepted canceled request") }
            canceled.fulfill()
        }
        transport.cancel(id: "cancel"); transport.cancel(id: "cancel")
        await fulfillment(of: [canceled], timeout: 2)
        ProofProtocol.handler = { $0.reply(Data("976100".utf8)) }
        let result = try await fetch(id: "cancel")
        XCTAssertEqual(result.body, "976100")
    }
    func testDuplicateAndConcurrentRequestLimits() async {
        ProofProtocol.handler = { _ in }
        let failures = expectation(description: "bounded")
        failures.expectedFulfillmentCount = 6
        for id in ["a", "b", "c", "d", "e", "a"] {
            transport.get(id: id, url: url, limit: 160) { result in
                if case .success = result { XCTFail("unexpected success") }
                failures.fulfill()
            }
        }
        transport.invalidate()
        await fulfillment(of: [failures], timeout: 2)
    }
    func testInvalidationRejectsNewRequests() async {
        transport.invalidate()
        do { _ = try await fetch(); XCTFail("accepted after invalidation") } catch {}
    }
    func testAbsoluteDeadlineStopsSilentResponse() async {
        ProofProtocol.handler = { _ in }
        let start = Date()
        do { _ = try await fetch(); XCTFail("accepted silent response") } catch {}
        XCTAssertLessThan(Date().timeIntervalSince(start), 11)
    }
}
