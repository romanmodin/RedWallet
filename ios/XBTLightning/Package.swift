// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "XBTLightning",
    platforms: [.iOS(.v16)],
    products: [.library(name: "XBTLightning", targets: ["XBTLightning"])],
    targets: [
        .binaryTarget(
            name: "Lndmobile",
            url: "https://github.com/Kilombino/kilowallet-ios/releases/download/v1.0.0-rc2/Lndmobile.xcframework.zip",
            checksum: "e135aeaa1dad6cdd5a77f1d6c7f194e49298cf67ce54f3811dfd9ac6c68da69d"
        ),
        .binaryTarget(
            name: "KilombinoTor",
            url: "https://github.com/Kilombino/kilowallet-ios/releases/download/v1.0.0-rc2/KilombinoTor.xcframework.zip",
            checksum: "d39a9f4b8ba61a8f5b3dd2d16ef6b83cf1bb00c4d31c6aef2901336691a161ea"
        ),
        .target(
            name: "XBTLightning",
            dependencies: ["Lndmobile", "KilombinoTor"],
            linkerSettings: [.linkedLibrary("resolv"), .linkedFramework("Security"), .linkedFramework("SystemConfiguration")]
        ),
        .testTarget(name: "XBTLightningTests", dependencies: ["XBTLightning"])
    ]
)
