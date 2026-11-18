#!/usr/bin/env bash
set -euo pipefail
root="$(git rev-parse --show-toplevel)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/Sources/XBTLightning" "$work/Tests/XBTLightningTests"
cp "$root/ios/XBTLightning/Sources/XBTLightning/TorFeeFetch.swift" "$work/Sources/XBTLightning/"
cp "$root/ios/XBTLightning/Tests/XBTLightningTests/TorFeeFetchTests.swift" "$work/Tests/XBTLightningTests/"
cat > "$work/Package.swift" <<'SWIFT'
// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "TorFeeFetchTests", platforms: [.macOS(.v13)], targets: [
    .target(name: "XBTLightning"),
    .testTarget(name: "XBTLightningTests", dependencies: ["XBTLightning"])
])
SWIFT
cd "$work"
swift test
