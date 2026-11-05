# RedWallet Lightning Android beta

This is the separate `com.romanmodin.redwallet.lightning` package. Keep the root `zapstore.yaml` for regular RedWallet unchanged.

The verified signed APK is public at:
https://github.com/romanmodin/RedWallet/releases/tag/android-live-xbt-42008700794

Version: 8.0.1 (22)
Source: a9cdd1542a88d500d24f0cd35916bf570a3cbbbe
APK SHA-256: 3331bfb2f74d850b64a9d08ab5b91e78cd4ce749a2793c269586f5ed86b58c48

The icon was extracted from this APK. Both screenshots show the actual installed APK running on an empty Android 16 emulator. QR/text switching, screenshot QR decoding, scrolling across the QR panel, and complete invoice clipboard copying passed. Physical-phone testing and funded live payments remain pending.

## Publication status — 5 November 2026

GitHub prerelease publication succeeded, with unauthenticated public access verified.

Zapstore publication is BLOCKED. Official zsp v2.0.1 returned:

```text
upload_rejected: blob upload rejected: upload icon: status 403:
authenticated pubkey is not allowed. Visit https://zapstore.dev/docs/publish for more information.
```

The existing publisher identity was preserved. Its non-expired certificate proof was independently verified by the prior official publisher, and the public default-branch root `zapstore.yaml` exactly matches that identity. No replacement key was generated. No Lightning app/release events were found on the official relay after the rejected older-client attempt.

The available signed-in Google account opens Play Console developer registration rather than a publishing dashboard. Enrollment or an already-enrolled account is required before upload. No account was created, agreement accepted, fee paid, or Play upload performed. An access request for Zapstore maintainers is prepared in SUPPORT-REQUEST.md and has not been submitted.

The complete listing configuration and media are ready here. Use the official publisher with the existing owner-managed signer once Zapstore restores access:

```sh
zsp publish -q fastlane/metadata/zapstore-lightning/zapstore.yaml
```

Keep signing credentials outside the repository. Retain the beta channel and existing signing identity. A successful process exit or pending acceptance is distinct from a verified published store listing; preserve the returned status.
