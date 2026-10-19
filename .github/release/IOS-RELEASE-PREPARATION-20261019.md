# Combined iOS release preparation — 2026-10-19

This is preparation, not an upload or App Store submission receipt.

The user deferred Android on October 18 and requested the combined iOS improvements, optional artwork skin, TestFlight delivery and App Store submission. Android results do not qualify this release.

## Frozen application source

- Public source: `dece41b5ebeed892b66c5fb3b8e1ba32dc07b8df` (combined PR51).
- Production mapping: 968 tracked production paths, SHA-256 `b087c9351883771dec81d0425bb27564c2f16b0d853f7745942f5b4503e594a3` using `verify-production-source.py`'s documented exclusions.
- Unit/lint: https://github.com/romanmodin/RedWallet/actions/runs/39182714947 — verified successful.
- iOS general: https://github.com/romanmodin/RedWallet/actions/runs/39182714863 — still running when this preparation was written.
- Funded iOS BIP84: https://github.com/romanmodin/RedWallet/actions/runs/39182714902 — still running when this preparation was written.

The protected signing/upload workflow now pins the public application commit directly. It no longer needs a private source copy or source-read deploy key. Existing signing/upload environments, encrypted IPA handling and signed-package verification remain. Both jobs independently reject wrong-source, wrong-repository, wrong-workflow, pending, failed, skipped or missing required gate jobs. Qualification uses the run's current attempt and is included in the IPA receipt. Fixture validation accepted a successful gate and rejected seven invalid-source/status/job/fork cases. YAML and shell syntax checks passed.

The capture-only workflow reuses the qualified simulator artifact, validates all three gates and records screenshot hashes and dimensions for iPhone/iPad. Its demo wallet is freshly generated and empty. Only explicit wallet/receive/artwork/recovery-options screenshots are saved; seed-screen capture, videos, automatic failure screenshots and hierarchy capture are disabled. No fake balance, private user wallet, or production-node interaction is used. These are simulator screenshots, not physical-device acceptance.

## App Store draft work

Live App Store Connect app `6817118871` is RedWallet XBT. Finance category and subtitle `Self-custody for XBT` saved. Content questionnaire completed with Apple's calculated 4+ age rating (regional variations); it is not categorized Made for Kids. Free pricing saved with the United States as base. Initial standard availability narrowed to the United States, with future countries disabled. United States shows Available on App Release; France shows Not Available. This avoids adding EU contact-publication and France-specific documentation to the first launch. No app has been released.

Still required before submission: successful exact-source iOS gates; merge app and orchestration; signed build and verified upload/Apple processing; actual reviewed screenshots; privacy policy publication and data-disclosure completion; current build selection and version alignment. Existing TestFlight 8.0.1(1791526289) is older and must not be submitted as the combined candidate. No release/submission receipt exists for the new candidate yet.

## Apple account and draft verification

Developer portal confirms Organization membership for ROMAN M WINTER MEDICAL INC., team PPG9C98EY9, and the program agreement accepted October 18, 2026. Apple email receipts confirm assignment at 2026-10-18T23:19:15Z and agreement acceptance at 23:19:57Z. Apple Support says activation can take up to 24 hours. App Store Connect still displays the old individual provider name and agreement-warning banner; propagation is a possible explanation, not a verified resolution. No new agreement was accepted by this run.

The App Store draft is now version 8.0.1, matching the frozen source marketing version. Reviewer instructions saved for fresh-wallet creation, receive QR, optional recovery, user-configured server, XBT-only signing, USDC display and optional artwork toggle. No build selected; no App Review submission receipt. The privacy disclosure draft says Data Not Collected (developer collection); it is not published and its policy URL still needs an accessible policy after merge.

The global EU trader declaration is not completed; no personal contact data was published or account-wide trader status changed. With France excluded, Apple’s encryption-documentation wizard was completed with standard algorithms in addition to OS encryption and no France distribution. Apple explicitly returned that no documents need uploading for those answers. The earlier France-selected wizard was cancelled without filing. Current source retains its existing ITSAppUsesNonExemptEncryption=false; no document was fabricated. Mac Apple Silicon and Vision Pro availability are disabled for this initial iPhone/iPad submission. Content Rights was saved with necessary rights to third-party content declared (upstream MIT notices retained).


## Public reviewer connection preflight

Review notes now offer the independently operated, publicly advertised `electrum.bitcoinxor.org`, TLS port `50002`, with TCP left empty. The operator lists it at https://bitcoinxor.org/wallet. A read-only preflight at 2026-10-19T01:29:07Z verified trusted TLS/hostname, the exact application checkpoint at 961640, 164-byte headers and tip 977938 agreeing with mempool.guide. Only server.version, block.header and headers.subscribe were queried. No wallet addresses, private data or transactions were sent. The independent operator may see address queries if used. This is protocol connectivity evidence, not SPV or native/physical-device interoperability. The source does not gain a bundled default server. Receipt: IOS-REVIEW-SERVER-PREFLIGHT-20261019.json.

At 01:33Z both iOS simulator build jobs had succeeded; the general Detox test job was running and the funded Native ios (rbf) job had started dependency installation. Unit/lint remains successful on the frozen application source.
