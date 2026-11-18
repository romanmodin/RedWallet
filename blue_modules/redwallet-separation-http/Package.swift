// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "SeparationHTTP",
    platforms: [.macOS(.v12), .iOS(.v15)],
    products: [.library(name: "SeparationHTTP", targets: ["SeparationHTTP"])],
    targets: [
        .target(name: "SeparationHTTP", path: "ios",
                exclude: ["RedWalletSeparationHTTP.swift", "RedWalletSeparationHTTP.m"],
                sources: ["SeparationHTTPTransport.swift"]),
        .testTarget(name: "SeparationHTTPTests", dependencies: ["SeparationHTTP"], path: "Tests")
    ]
)
