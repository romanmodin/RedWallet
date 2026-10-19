import XCTest

// Fresh hosted simulator only. Opens Apple's sample conversation; never sends a message.
final class StickerCapture: XCTestCase {
    private func record(_ app: XCUIApplication, _ name: String) {
        let hierarchy = XCTAttachment(string: app.debugDescription)
        hierarchy.name = name + "-hierarchy"
        hierarchy.lifetime = .keepAlways
        add(hierarchy)
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
        print("CAPTURE STATE " + name + "\n" + app.debugDescription)
    }

    private func visible(_ app: XCUIApplication, _ label: String) -> XCUIElement? {
        let matches = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label))
        for element in matches.allElementsBoundByIndex where element.exists && element.isHittable {
            return element
        }
        return nil
    }

    private func waitForPanel(_ app: XCUIApplication) {
        // Retained 39236628098 evidence shows Apple's sticker panel loading asynchronously.
        // Wait for that observed spinner, rather than searching an unfinished hierarchy.
        let ready = XCTNSPredicateExpectation(predicate: NSPredicate { _, _ in
            !app.activityIndicators.allElementsBoundByIndex.contains { $0.exists && $0.isHittable }
        }, object: nil)
        let result = XCTWaiter.wait(for: [ready], timeout: 15)
        if result != .completed { record(app, "messages-panel-still-loading") }
        XCTAssertEqual(result, .completed, "Apple's app panel must finish loading before capture")
    }

    func testCaptureQualifiedStickerExtension() throws {
        continueAfterFailure = false
        let messages = XCUIApplication(bundleIdentifier: "com.apple.MobileSMS")
        messages.launch()
        XCTAssertTrue(messages.wait(for: .runningForeground, timeout: 30))
        record(messages, "messages-initial")

        // This seeded sample was observed in the fresh simulator's retained hierarchy.
        let sample = messages.staticTexts["+1 (888) 555-1212"]
        XCTAssertTrue(sample.waitForExistence(timeout: 10), "Expected Apple's disposable simulator conversation")
        sample.tap()
        record(messages, "messages-conversation")

        var openedPack = false
        var used = Set<String>()
        for step in 0..<5 {
            if let pack = visible(messages, "BlueWallet") {
                pack.tap()
                waitForPanel(messages)
                openedPack = true
                record(messages, "imessage-extension-candidate")
                // iPad evidence shows the selected pack before its images render.
                // Retain bounded later observations for visual review, without sending a sticker.
                Thread.sleep(forTimeInterval: 2)
                record(messages, "imessage-extension-after-2s")
                Thread.sleep(forTimeInterval: 6)
                record(messages, "imessage-extension-after-8s")
                break
            }
            // Only open app/sticker menus. Never target Send, a contact action, or account setup.
            let labels = ["add", "Apps", "Show Apps", "Add Apps", "Add", "More", "Stickers"]
            var advanced = false
            for label in labels where !used.contains(label) {
                if let control = visible(messages, label) {
                    used.insert(label)
                    control.tap()
                    waitForPanel(messages)
                    record(messages, "messages-menu-" + String(step))
                    advanced = true
                    break
                }
            }
            if !advanced { break }
        }
        XCTAssertTrue(openedPack, "Qualified BlueWallet sticker extension must be opened; inspect retained UI, do not substitute a main-app screenshot")
        print("Candidate captured. Human visual review is required before App Store upload.")
    }
}
