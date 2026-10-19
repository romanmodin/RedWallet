import XCTest

// Disposable simulator only. No Apple Account, contacts, messages or wallet funds.
final class StickerCapture: XCTestCase {
    func testInspectMessagesForStickerCapture() throws {
        continueAfterFailure = false
        let messages = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        messages.launch()
        XCTAssertTrue(messages.wait(for: .runningForeground, timeout: 30))
        let hierarchy = XCTAttachment(string: messages.debugDescription)
        hierarchy.name = "messages-initial-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = "messages-initial"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        print("DIAGNOSTIC ONLY: this is not an approved App Store screenshot.")
        print(messages.debugDescription)
    }
}
