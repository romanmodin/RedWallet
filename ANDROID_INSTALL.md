# RedWallet Android beta

The Android beta is distributed as an APK through [GitHub Releases](https://github.com/romanmodin/RedWallet/releases/tag/android-v8.0.1-beta-1791146077). It is not listed on Google Play.

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

## Check an installed Android release

Settings → About shows the app version, build number and package ID. Compare these with the intended release receipt. For an independent package check, Android platform tools can locate and pull the installed APK:

```sh
adb shell pm path com.romanmodin.redwallet
# Substitute the returned base.apk path, without the package: prefix.
adb pull /returned/path/base.apk RedWallet-installed.apk
sha256sum RedWallet-installed.apk
apksigner verify --verbose --print-certs RedWallet-installed.apk
```

For the direct APK distribution, compare the SHA-256 to that release's `SHA256SUMS.txt`, and the signer SHA-256 to the persistent release certificate:

`7843791c3cf340458fbf400a204361a0a97ac9c2902ae36c4511396f1f55884f`

Android also checks signatures when installing updates. A matching package hash verifies the package against the published artifact; it does not prove that the artifact is safe, that its source was independently reproduced, or that the phone and wallet data are uncompromised. The app's self-test is a functional check, not a security attestation. Keep recovery material offline and never provide it for verification.
