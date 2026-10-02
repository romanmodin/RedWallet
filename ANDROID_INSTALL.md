# RedWallet Android beta

The Android beta is distributed as an APK through [GitHub Releases](https://github.com/romanmodin/RedWallet/releases/tag/android-v8.0.1-beta-1790940564). It is not listed on Google Play.

## Install on a phone

1. Open the Android beta release page in your phone's browser.
2. Under Assets, download the file named `RedWallet-8.0.1-android-beta-<build>.apk`.
3. Open the downloaded APK. If Android asks, allow your browser or file manager to install unknown apps.
4. Tap Install, then open RedWallet. You can turn that installation permission off afterward.
5. Start with an empty test wallet and configure an XBT-compatible Fulcrum server in Settings.

Requires Android 7.0 (API 24) or newer. The APK includes 64-bit ARM, 32-bit ARM and x86_64 code and bundles the application; a Metro server or development computer is not required.

## Updates and existing wallets

RedWallet has its own application ID, `com.romanmodin.redwallet`, and installs separately from BlueWallet. It does not automatically migrate BlueWallet data. Preserve your recovery backup.

Install future official APK updates over the existing RedWallet app. Updates must use the same release signing certificate; do not uninstall to update. An emulator APK signed with a disposable test key cannot update to the release key in place.

## Verify a download

Each release includes `SHA256SUMS.txt`, `android-release-receipt.json` and the public signing-certificate fingerprint. The receipt records the source commit, build run, version code, architectures and signed APK hash. Verify the APK hash against the checksum file.

The build workflow contains no release signing secrets. A disposable key is used only for CI installation checks; the published APK is signed separately with the persistent RedWallet release key.

An emulator installation/launch check does not establish physical-phone compatibility, full send/confirmation behavior, or absence of security vulnerabilities. This remains an early beta.
