// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "XBTLightning",
    platforms: [.iOS(.v16)],
    products: [.library(name: "XBTLightning", targets: ["XBTLightning"])],
    targets: [
        .binaryTarget(
            name: "Lndmobile",
            url: "https://github.com/romanmodin/RedWallet/releases/download/ios-lnd-peer-funding-8fadd7391/Lndmobile.xcframework.zip",
            checksum: "ab4fcfcf3e71b0e6f9339eec2d89b308f64b800939c14ad78fc1a9aca7d93054"
        ),
        .binaryTarget(
            name: "KilombinoTor",
            url: "https://github.com/Kilombino/kilowallet-ios/releases/download/v1.0.0-rc2/KilombinoTor.xcframework.zip",
            checksum: "d39a9f4b8ba61a8f5b3dd2d16ef6b83cf1bb00c4d31c6aef2901336691a161ea"
        ),
        .target(
            name: "XBTLightning",
            dependencies: ["Lndmobile", "KilombinoTor"],
            resources: [.copy("Resources/Lightning-Tor-Notices.txt"), .copy("Resources/Lndmobile-LICENSE.txt")],
            linkerSettings: [.linkedLibrary("resolv"), .linkedFramework("Security"), .linkedFramework("SystemConfiguration")]
        ),
        .testTarget(name: "XBTLightningTests", dependencies: ["XBTLightning"])
    ]
)
