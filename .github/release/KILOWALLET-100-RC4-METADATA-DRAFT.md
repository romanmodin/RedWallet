# Kilowallet 1.0 RC4 — replacement metadata draft

## Superseding public submission checkpoint — November 6, 19:28 UTC

Roman explicitly approved replacing the pending0.4 review with build10 and all five privacy disclosures (App Functionality, linked to identity, no tracking), including the final two categories separately. The interactive submission completed for1.0.0(10), submission6bf59af8-3a6b-4f97-b51c-c3c48ade9b38. The prior privacy approval blocker is resolved by those later explicit approvals; do not repeat the questionnaire or resubmit.

Independent protected GET-only preflight42279796319/attempt1 observed2026-11-06T19:28:25.918Z confirms version1.0.0 WAITING_FOR_REVIEW, versionID1ca23695-4563-4a0e-b20e-d1a6457f4f8b, exactlyUSA/noautomaticexpansion/errors[]. Artifact13535246557 SHA-256f0250b52299522fc2c50afe22c6c877445894e92a95a20a7a83e4a730209b2d2 was API-digest and ZIP-CRC verified. This preflight proves current version state and territories; its historicalbuild3 section is not fresh build10 association or privacy-label evidence. Exact build10 selection and published labels are evidenced by the interactive submission confirmation, not this API read.

Preserve the new1.0.0 review. The0.4 preservation and unsubmitted-draft instructions below are historical and superseded. No new app upload, review withdrawal, agreement or legal attestation is needed. The separate build8 TestFlight review is not withdrawn by the public App Store replacement; use fresh beta diagnosis before any guarded distribution action.


Updated November 6, 2026 for signed and uploaded version **1.0.0 (10)**, Apple build `bccd1b6c-e89b-45e9-909e-0936bd558994`, publisher app source `5ac15b5eeb26296d69008a39e7ff1b4e23d4f8c5`. This public-review metadata is prepared but has not been submitted to Apple. Internal TestFlight availability is verified; external availability is still blocked by the earlier build8 beta review. The existing 0.4.0 review and its metadata remain in place. The currently checked-in app review notes still describe RC3/v1–v5 and must not be copied unchanged for RC4.

## Proposed description

Kilowallet is a self-custodial iPhone wallet for Bitcoin on the BLAKE2b chain (XBT). Create and restore wallets, receive payments with QR codes, and review amounts and network fees before sending.

Manage multiple wallets, watch-only wallets and individual coins. Use SegWit or Taproot, export transactions for external signing, and increase the fee of an eligible unconfirmed transaction. Recovery words are stored in the iOS Keychain. Back up your recovery words securely.

Kilojoin pools let compatible wallets build a shared transaction. Your wallet checks its outputs, change and fees before you approve signing. Asynchronous v6 pools retain their progress so you can return and continue later. You must reopen the app and respond before each deadline; iOS does not keep the round running continuously in the background. If you create a pool on the iPhone, keep the app open while it runs the pool. CoinJoin is experimental and does not guarantee anonymity.

The Lightning view runs a node on the iPhone. Open and manage channels, pay and receive Lightning invoices, and use a watchtower over Tor. An optional operator-run bridge pays a SHA-256 Lightning invoice using XBT; review the quote before approving. Channel funding, available liquidity and connectivity affect what can be paid or received.

Ark is an optional network service with its own operator, terms, recovery requirements and privacy practices. Password-protected backups can include wallet recovery material, Ark data and a static Lightning channel backup. Keep backup files and their passwords secure.

Configure your Electrum server and Tor preferences. Network transaction fees apply. This app operates on BLAKE2b XBT; its on-chain balance is separate from SHA-256 Bitcoin.

Created by Kilombino. This iOS distribution is maintained by romanmodin with the author’s permission.

## Proposed review notes

This is an upgrade of the existing Kilowallet app, bundle `com.kilombino.kilowallet`, version1.0.0. Replacement build: **10**, Apple build ID `bccd1b6c-e89b-45e9-909e-0936bd558994`. Signed upload run42253151290/attempt1 and verification artifact13524776804 bind this build to source5ac15b5eeb26296d69008a39e7ff1b4e23d4f8c5; see the release handoff for full digests. No account or app login is required. Create a new empty wallet to inspect the on-chain, Kilojoin, Lightning and Ark views. Reviewers should use synthetic/demo material and should not enter recovery words from a funded wallet. Watch-only import supports inspection without signing or access to the corresponding private keys.

This release supports Kilojoin v1–v6, including persisted asynchronous v6 attempts, acknowledgements and catch-up snapshots. Transaction signing requires the user's explicit approval and local authentication. A returning snapshot cannot cause automatic signing. Reopen the app to continue; there is no continuous iOS background round service or dedicated round push notifications. Signed input reservations remain until the round resolves. Completion and confirmed-conflict release use six confirmations; an elapsed timer alone does not unlock a signed input.

Lightning is an embedded LND node. The optional bridge exchanges XBT for settlement of a SHA-256 Lightning invoice through the operator. It does not merge the two on-chain networks. Ark uses an independent server. Network features require connectivity and, where applicable, funded channels or coins. Reviewers need not transact to inspect the app.

The app requests camera permission for QR scanning and supports local notifications and iOS background refresh/processing when permitted. Wallet recovery words use the device Keychain. A deliberate password-protected .kab export can contain recovery material, Ark data and a static Lightning channel backup. A separate Lightning move file can contain live channel state. These user-directed exports can leave the device.

Original source, license and publisher issue reporting: https://github.com/romanmodin/kilowallet-ios . This draft asserts source behavior only. Native qualification, physical-device results, joint-regtest interoperability, signed packaging and Apple build eligibility must be reported from actual receipts. No physical-device or joint-regtest pass is claimed here.

## Service-privacy facts to carry into the replacement review

- Kilojoin: with app Tor running, onion relay first, then public wss relay through Tor; both failures produce an error. Tor off permits direct relay use. The operator reports no IP logs and seven-day relay-event retention. Public endpoints may involve Cloudflare. Routing does not guarantee anonymity.
- Bridge: this publisher source sets `Bridge.torPort = { null }` in Lightning.kt. It contacts the bridge through HTTPS/Cloudflare even while the node uses Tor. Do not copy the maintainer's general onion-route statement as an observed property of this build. Operator-reported memory-only IP rate limiting lasts until one hour without requests. Quote/proof/re-quote records expire as disclosed; LND swap journals, including the destination invoice and recipient node ID, are retained indefinitely. No blanket no-data-collected assertion is supported.
- Watchtower: onion-only service with per-session keys and encrypted breach-remedy records; operator-reported retention lasts until the client deletes the session after channels close. This does not establish current runtime registration success.
- Ark: Paperclip Holdings LLC operates ark.paperclippool.xyz. Its notice covers possible IP logs, public keys, VTXO identifiers, invoices, payment hashes, amounts and recovery data, with purpose-dependent retention. https://pool.paperclippool.xyz/privacy and https://pool.paperclippool.xyz/terms . No terms are accepted in this preparation.
- The selected Electrum server sees queries and transactions and, on a direct connection, the client's network address. Backup exports can contain secrets at the user's direction. Apple privacy-label answers require a separate review of these facts, not automatic reuse of 0.4 answers.

## Activation prerequisites

Exact build10 has passed native qualification, synthetic migration/isolation, visual/runtime qualification, protected signing, upload and Apple VALID processing. See KILOWALLET-100-RC4-FINAL-HANDOFF-20261105.md for exact source, IPA, run and artifact receipts. This does not assert a physical-phone install or funded recovery test.

The protected GET-only diagnostic at2026-11-06T18:09:19.259Z found build10 IN_BETA_TESTING internally and assigned to both original groups, but externally READY_FOR_BETA_SUBMISSION with no review. Prior build8 is WAITING_FOR_BETA_REVIEW. Preserve its review position; use the existing diagnose and guarded apply path once that review clears. Group membership alone is insufficient for public beta installation.

Latest verified public status is the17:28:16Z November6 GET-only snapshot: existing0.4.0 WAITING_FOR_REVIEW, exactlyUSA and automatic territory expansion disabled. Refresh this status before public submission. The historical build3 information in that public preflight is not qualification of build10.

The prior Apple questionnaire, with standard encryption outside the OS and France excluded, returned no documents required. Build10 uses Boolean ITSAppUsesNonExemptEncryption=false and no export-compliance code under the verified USA-only scope. No ECCN, CCATS or broader legal determination is asserted. Any change to distribution scope needs separate reassessment; no new agreement is accepted here.

Before activating this draft, verify exact build10 eligibility for the intended TestFlight groups, then reconcile live App Store privacy labels and the published privacy policy against the service facts above. Review contact details and screenshots must match the replacement. Do not automatically reuse0.4 privacy answers or assert no data collection. Keep the existing review until the replacement qualifies; no App Store fields are changed by this document.
