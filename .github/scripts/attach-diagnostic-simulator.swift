import AppKit
import CoreGraphics
import Foundation

// Diagnostic runner setup only. Opening an already-running Simulator does not
// prove that its device window has attached. Launch an explicit instance for the
// selected disposable UDID and observe its actual on-screen window before Detox
// requests orientation. This neither changes the app nor retries rotation.
guard CommandLine.arguments.count == 3,
      UUID(uuidString: CommandLine.arguments[1]) != nil else {
    fputs("Usage: attach-diagnostic-simulator UDID SIMULATOR_APP\n", stderr)
    exit(2)
}
let udid = CommandLine.arguments[1]
let appURL = URL(fileURLWithPath: CommandLine.arguments[2])
let config = NSWorkspace.OpenConfiguration()
config.arguments = ["-CurrentDeviceUDID", udid]
config.activates = true
config.createsNewApplicationInstance = true
var launched: NSRunningApplication?
var launchError: Error?
var completed = false
NSWorkspace.shared.openApplication(at: appURL, configuration: config) { app, error in
    launched = app
    launchError = error
    completed = true
}
let deadline = Date().addingTimeInterval(30)
var receipt: [String: Any] = ["requestedUDID": udid, "windowObserved": false]
while Date() < deadline {
    RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    if completed && launched == nil {
        fputs("Simulator launch failed: \(String(describing: launchError))\n", stderr)
        exit(1)
    }
    guard let app = launched else { continue }
    let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
    let matching = windows.filter { window in
        guard (window[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value == app.processIdentifier,
              (window[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
              let bounds = window[kCGWindowBounds as String] as? [String: NSNumber],
              let width = bounds["Width"]?.doubleValue,
              let height = bounds["Height"]?.doubleValue else { return false }
        return width >= 200 && height >= 200
    }
    receipt["pid"] = app.processIdentifier
    if !matching.isEmpty {
        receipt["windowObserved"] = true
        receipt["windows"] = matching.map { ["bounds": $0[kCGWindowBounds as String] ?? [:], "title": $0[kCGWindowName as String] ?? ""] }
        break
    }
}
let data = try JSONSerialization.data(withJSONObject: receipt, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
if receipt["windowObserved"] as? Bool != true { exit(1) }
