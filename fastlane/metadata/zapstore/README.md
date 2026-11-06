# Zapstore publisher metadata

The root `zapstore.yaml` targets the original `com.romanmodin.redwallet` application and original publisher identity. The isolated `.lightning` APK is a separate testing package and is not the existing-app store update.

The candidate adds live XBT Lightning and QR/text invoice cards. Current-source lint, unit tests, the disabled-Firebase native regression, and public XBT sync passed. An installed signed upgrade preserved the empty wallet and receiving address originally created in standard version 1791613448. The existing empty Lightning wallet unlocked after the update. The signed APK also passed QR decoding, QR/text switching, scrolling, complete clipboard copy/paste, and foreground resume. Parent Android UI and disposable-chain lifecycle checks cover unchanged wallet and Lightning bridge code. The signing certificate is unchanged. Physical-phone and funded live payment tests remain open.

The original four store screenshots show an earlier standard Android beta with an empty disposable wallet and a manual demo quote. The two Lightning invoice screenshots come from this exact signed APK on an empty emulator node. Do not fund the pictured address. No private signing credentials belong in the repository.

Current candidate details and store acceptance are recorded in `publication-status.json`. Historical verified publication evidence remains in `publication-receipt.json` and `RELEASE.md`; it is not proof that this new candidate has been accepted.

Publisher: npub18w06dfgs9f6n2ppytceqnd7hy7ss67cdenmwnulxjvmpq2pq3q5sqwx5l0
APK source: b33416b427766a07e315ce937a6766c3fdac9e70
Version code: 1793900454
APK SHA-256: b7d3b20108f5f0a285c8a868cdd32992fed6e83b9ba4f705d6b509b277140e5a

Verified on 2026-11-06T18:41:45Z: this exact APK is published through the required `main` catalog channel while remaining explicitly labeled as an early beta. Signed app/release/asset records and the complete listed APK download hash were verified. The original publisher access was restored by the maintainer. See `publication-receipt-20261106.json`.
