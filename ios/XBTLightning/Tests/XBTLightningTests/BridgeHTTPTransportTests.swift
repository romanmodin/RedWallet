import XCTest
@testable import XBTLightning

private final class BridgeProtocolFixture: URLProtocol {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        guard request.url!.path != "/api/quote" else { return } // cancellation fixture
        let response = HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: [:])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if request.url!.path == "/api/pow" {
            client?.urlProtocol(self, didLoad: Data(repeating: 65, count: 20000))
            client?.urlProtocol(self, didLoad: Data(repeating: 65, count: 20000))
        } else { client?.urlProtocol(self, didLoad: Data("{\"open\":true}".utf8)) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
final class BridgeHTTPTransportTests: XCTestCase {
    let origin = "https://bridge.kilombino.com"
    let quoteBody = "{\"invoice\":\"lnbc1fixture\",\"pow\":{\"challenge\":\"challenge\",\"nonce\":\"0\"}}"
    func client() -> BridgeHTTPTransport {
        let config = BridgeHTTPTransport.configuration()
        config.protocolClasses = [BridgeProtocolFixture.self]
        return BridgeHTTPTransport(configuration: config)
    }
    func testIsolatedSessionHasNoSharedCookiesCredentialsOrCache() throws {
        let config = BridgeHTTPTransport.configuration()
        XCTAssertNil(config.httpCookieStorage)
        XCTAssertNil(config.urlCredentialStorage)
        XCTAssertNil(config.urlCache)
        XCTAssertFalse(config.httpShouldSetCookies)
        XCTAssertEqual(config.timeoutIntervalForResource, 15)
        let request = try BridgeHTTPTransport.request(url: origin + "/api/quote", method: "POST", body: quoteBody)
        XCTAssertFalse(request.httpShouldHandleCookies)
        XCTAssertNil(request.value(forHTTPHeaderField: "Authorization"))
        XCTAssertNil(request.value(forHTTPHeaderField: "Cookie"))
        XCTAssertEqual(request.value(forHTTPHeaderField: "User-Agent"), "RedWallet")
    }
    func testOnlyPinnedHTTPSAPIAndExpectedPayloadAreAllowed() throws {
        for url in ["http://bridge.kilombino.com/api/info", "https://other.example/api/info",
                    "https://bridge.kilombino.com.other.example/api/info", "https://user:pass@bridge.kilombino.com/api/info",
                    origin + ":443/api/info", origin + "/api/info?token=private", origin + "/api/info#fragment", origin + "/"] {
            XCTAssertThrowsError(try BridgeHTTPTransport.request(url: url, method: "GET", body: ""))
        }
        XCTAssertThrowsError(try BridgeHTTPTransport.request(url: origin + "/api/info", method: "POST", body: "{}"))
        XCTAssertThrowsError(try BridgeHTTPTransport.request(url: origin + "/api/quote", method: "POST", body: "{\"macaroon\":\"secret\"}"))
        let status = origin + "/api/swap/" + String(repeating: "ab", count: 32) + "?t=" + String(repeating: "cd", count: 16)
        XCTAssertNoThrow(try BridgeHTTPTransport.request(url: status, method: "GET", body: ""))
    }
    func testPaperclipBuildsOnlyTheDocumentedXBTToSHA256Requests() throws {
        let api = "https://lightning.paperclip-xbt.xyz/bridge/api/"
        let preview = #"{"invoice":"lnbc1fixture","direction":"toSHA256"}"#
        let quote = #"{"invoice":"lnbc1fixture","direction":"toSHA256","pow":{"challenge":"challenge","nonce":"0"}}"#
        let swap = "swap/" + String(repeating: "ab", count: 32) + "?t=" + String(repeating: "cd", count: 16)
        for endpoint in ["info?direction=toSHA256", "pow", swap] {
            let get = try BridgeHTTPTransport.request(url: api + endpoint, method: "GET", body: "")
            XCTAssertEqual(get.url?.absoluteString, api + endpoint)
            XCTAssertNil(get.httpBody)
        }
        for (endpoint, payload) in [("check", preview), ("quote", quote)] {
            let post = try BridgeHTTPTransport.request(url: api + endpoint, method: "POST", body: payload)
            XCTAssertEqual(post.httpBody, Data(payload.utf8))
            XCTAssertEqual(post.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertFalse(post.httpShouldHandleCookies)
        }
    }
    func testProviderPathsAndPayloadsCannotBeInterchanged() {
        let base = "https://lightning.paperclip-xbt.xyz"
        let api = base + "/bridge/api/"
        let preview = #"{"invoice":"lnbc1fixture","direction":"toSHA256"}"#
        for path in ["/api/pow", "/bridge/api/info", "/bridge/api/info?direction=toBLAKE2b",
                     "/bridge/api/pow?direction=toSHA256", "/bridge/api/%70ow"] {
            XCTAssertThrowsError(try BridgeHTTPTransport.request(url: base + path, method: "GET", body: ""))
        }
        XCTAssertThrowsError(try BridgeHTTPTransport.request(url: origin + "/api/check", method: "POST", body: preview))
        XCTAssertThrowsError(try BridgeHTTPTransport.request(url: api + "quote", method: "POST", body: quoteBody))
        XCTAssertThrowsError(try BridgeHTTPTransport.request(url: api + "quote", method: "POST", body: preview))
        for payload in [#"{"invoice":"lnbc1fixture","direction":"toBLAKE2b"}"#,
                        #"{"invoice":"lnbc1fixture","direction":"toSHA256","extra":"fixture"}"#] {
            XCTAssertThrowsError(try BridgeHTTPTransport.request(url: api + "check", method: "POST", body: payload))
        }
    }
    func testRedirectIsRefusedBeforeAnyFollowUpRequest() {
        let transport = client()
        defer { transport.invalidate() }
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let task = session.dataTask(with: URL(string: origin + "/api/quote")!)
        let response = HTTPURLResponse(url: task.originalRequest!.url!, statusCode: 307, httpVersion: "HTTP/1.1", headerFields: ["Location": "https://other.example/invoice"])!
        var called = false
        transport.urlSession(session, task: task, willPerformHTTPRedirection: response,
                             newRequest: URLRequest(url: URL(string: "https://other.example/invoice")!)) { followUp in
            called = true
            XCTAssertNil(followUp)
        }
        XCTAssertTrue(called)
    }
    func testOfflineResponseCompletesOnceWithoutNetworkAccess() {
        let transport = client()
        defer { transport.invalidate() }
        let done = expectation(description: "response")
        done.assertForOverFulfill = true
        transport.request(id: "valid", url: origin + "/api/info", method: "GET", body: "") { result in
            switch result {
            case .success(let response):
                XCTAssertEqual(response["status"] as? Int, 200)
                XCTAssertEqual(response["body"] as? String, "{\"open\":true}")
            case .failure(let error): XCTFail(String(describing: error))
            }
            done.fulfill()
        }
        wait(for: [done], timeout: 3)
    }
    func testChunkedOversizedResponseIsRejectedBeforeAccumulatingIt() {
        let transport = client()
        defer { transport.invalidate() }
        let done = expectation(description: "oversized")
        done.assertForOverFulfill = true
        transport.request(id: "large", url: origin + "/api/pow", method: "GET", body: "") { result in
            if case .success = result { XCTFail("Oversized response accepted") }
            done.fulfill()
        }
        wait(for: [done], timeout: 3)
    }
    func testCanceledRequestCannotReturnSuccess() {
        let transport = client()
        defer { transport.invalidate() }
        let done = expectation(description: "canceled")
        done.assertForOverFulfill = true
        transport.request(id: "cancel", url: origin + "/api/quote", method: "POST", body: quoteBody) { result in
            if case .success = result { XCTFail("Canceled request accepted") }
            done.fulfill()
        }
        transport.cancel(id: "cancel")
        wait(for: [done], timeout: 3)
    }
}
