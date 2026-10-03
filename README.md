# RedWallet for iPhone and Android

RedWallet is an XBT wallet based on [BlueWallet 8.0.1](https://github.com/BlueWallet/BlueWallet/releases/tag/8.0.1). This is an independent community project, not an official BlueWallet release. The upstream MIT license and attributions are retained.

## Try the beta

The iPhone beta is available through TestFlight to invited testers. The signed Android phone beta is available from [GitHub Releases](https://github.com/romanmodin/RedWallet/releases/tag/android-v8.0.1-beta-1790940564). See [ANDROID_INSTALL.md](ANDROID_INSTALL.md) for installation and update instructions. Android 7.0 or newer is required; Google Play distribution is not enabled.

## Scope and verification

The current XBT wallet supports one Native SegWit/P2WPKH BIP84 account, Unified Sighash signing, wallet recovery, Fulcrum balance and transaction history, QR receive/send, configurable servers, and XBT pricing. Hardware signing, Taproot, multisig, silent payments and Lightning are outside this release.

History is fetched for discovered receive and change addresses; it is not limited to transactions created in RedWallet. The tester who reported a restored balance with missing history resolved it by fixing their server, as reported by the maintainer on October 2, 2026. That case was server-side; this is not a claim that every recovery scenario has been independently validated.

PR #1 has been reviewed and merged. Signing checks use published vectors and independent regression fixtures. The Android release package passed emulator installation and launch checks, and its signature, alignment and payload were verified. Each release includes an APK checksum and a receipt identifying its source commit, CI run and signing certificate.

This remains an early beta. Physical iPhone checks covered recovery, persistence, receive/QR, send review and cancellation. A full live send/confirmation flow and physical Android-phone compatibility have not yet been verified. Emulator launch success is not a complete security audit. Preserve recovery backups and start with an empty test wallet.

RedWallet installs separately from BlueWallet and does not automatically migrate its data. Future Android APK updates must use the same RedWallet release certificate. Never commit signing certificates, API keys, seed phrases, private keys or wallet backups.

## Contributing

Independent review and focused pull requests are welcome. Include reproducible tests and public fixtures for transaction, signing or chain changes. Do not include wallet secrets or private transaction details in issues, pull requests or screenshots. See [PROJECT_SCOPE.md](PROJECT_SCOPE.md) for the original implementation plan.

## License

RedWallet inherits the MIT license from BlueWallet. See [LICENSE](LICENSE) and retain upstream copyright notices when modifying or redistributing source files.
