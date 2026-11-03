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
        .target(
            name: "XBTLightning",
            dependencies: ["Lndmobile"],
            linkerSettings: [.linkedLibrary("resolv"), .linkedFramework("Security"), .linkedFramework("SystemConfiguration")]
        )
    ]
)
