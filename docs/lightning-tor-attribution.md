# Lightning Tor dependency attribution

RedWallet uses the KilombinoTor XCFramework from Kilombino/kilowallet-ios release v1.0.0-rc2:
https://github.com/Kilombino/kilowallet-ios/releases/tag/v1.0.0-rc2

The binary is pinned in ios/XBTLightning/Package.swift with SHA-256:
`d39a9f4b8ba61a8f5b3dd2d16ef6b83cf1bb00c4d31c6aef2901336691a161ea`.

ArtiRuntime.swift is adapted from Kilombino's iosApp/iosApp/ArtiEngine.swift. The upstream project is licensed under Apache License 2.0. Its license is reproduced in docs/licenses/Kilombino-Apache-2.0.txt. The wrapper is modified to use RedWallet-managed runtime storage and startup lifecycle. No affiliation or service endorsement is implied.

The upstream engine records Arti tag arti-v2.7.0, commit ce8bc6e0998bd5a4efdf06dd62dce53c98ea1087 in tor-engine/ENGINE. Arti is licensed under MIT OR Apache-2.0. Dependency and source notices remain available in the upstream tor-engine source tree.

The selectable watchtower URI comes from Kilombino/kilowallet core Lightning.kt at d1fd03b2e06bd04fc19da35df2406f6b771a41cb. This is a user-selectable public preset, not automatic enrollment or a guarantee of availability.
