# Zapstore publisher metadata

This publishes the existing signed Android tester beta; it does not rebuild or re-sign the APK. The root zapstore.yaml contains only public publisher/app metadata. The dedicated RedWallet Nostr public key is pinned there for repository verification. No private publisher key, Android keystore or password belongs in this repository.

The four screenshots are from the exact signed APK, capture run 37115128237, on an Android emulator with an empty disposable wallet and a manually entered demo quote. Do not fund the displayed address. The real Android handset/cold-signer interoperability checks remain open.

The production-tree verifier excludes only the root zapstore.yaml as store metadata, alongside the existing fastlane/metadata exclusion. App source, lockfiles and dependencies remain covered. The reviewed 941-entry production hash remains unchanged. Historical package receipts retain their original tree definition.

Publisher key: npub18w06dfgs9f6n2ppytceqnd7hy7ss67cdenmwnulxjvmpq2pq3q5sqwx5l0

Android APK SHA-256: e966c2f9594f9e1894c48bf6857fe4df07f51dc04cb83bc53c9db77ed11f438c

Publication status is recorded in RELEASE.md after relay acceptance and read-back verification.
