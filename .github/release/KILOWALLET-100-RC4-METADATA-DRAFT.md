# Kilowallet 1.0 RC4 — replacement metadata draft

Prepared November 5, 2026 against publisher app source `556fe57656c9ccac193023466c104ef324b08770`. This is a draft for the qualified replacement build. It has not been submitted to Apple. The existing 0.4.0 review and its metadata remain in place. The currently checked-in app review notes still describe RC3/v1–v5 and must not be copied unchanged for RC4.

## Proposed description

Kilowallet is a self-custodial iPhone wallet for Bitcoin on the BLAKE2b chain (XBT). Create and restore wallets, receive payments with QR codes, and review amounts and network fees before sending.

Manage multiple wallets, watch-only wallets and individual coins. Use SegWit or Taproot, export transactions for external signing, and increase the fee of an eligible unconfirmed transaction. Recovery words are stored in the iOS Keychain. Back up your recovery words securely.

Kilojoin pools let compatible wallets build a shared transaction. Your wallet checks its outputs, change and fees before you approve signing. Asynchronous v6 pools retain their progress so you can return and continue later. You must reopen the app and respond before each deadline; iOS does not keep the round running continuously in the background. If you create a pool on the iPhone, keep the app open while it runs the pool. CoinJoin is experimental and does not guarantee anonymity.

The Lightning view runs a node on the iPhone. Open and manage channels, pay and receive Lightning invoices, and use a watchtower over Tor. An optional operator-run bridge pays a SHA-256 Lightning invoice using XBT; review the quote before approving. Channel funding, available liquidity and connectivity affect what can be paid or received.

Ark is an optional network service with its own operator, terms, recovery requirements and privacy practices. Password-protected backups can include wallet recovery material, Ark data and a static Lightning channel backup. Keep backup files and their passwords secure.

Configure your Electrum server and Tor preferences. Network transaction fees apply. This app operates on BLAKE2b XBT; its on-chain balance is separate from SHA-256 Bitcoin.

Created by Kilombino. This iOS distribution is maintained by romanmodin with the author’s permission.

## Proposed review notes

This is an upgrade of the existing Kilowallet app, bundle `com.kilombino.kilowallet`, version1.0.0. Insert the exact qualified uploaded build number and receipt when available. No account or app login is required. Create a new empty wallet to inspect the on-chain, Kilojoin, Lightning and Ark views. Reviewers should use synthetic/demo material and should not enter recovery words from a funded wallet. Watch-only import supports inspection without signing or access to the corresponding private keys.

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

Keep existing0.4.0 review in place until the replacement qualifies. Around 07:10 Pacific Nov5 the live Apple interface showed0.4.0 Waiting for Review, old0.4.0build3 Testing in Kilowallet Internal/Public Beta, and upload history containing only completed0.4.0build3 and0.1.0build1. No1.0 eligibility was visible. No Apple fields were edited.

App native42069725060/attempt1/job127394003433 is IN_PROGRESS as of18:23Z November5. Exact-source migration10 and both macOS screenshot checkers passed. Native unit/execution/async-reservation gates and simulator compilation passed; screenshot capture, live runtime outcomes and unsigned arm64 Release remain pending. Earlier8238 native42036850517 failed and cannot qualify this source. Inspect all actual current artifacts, runtime and visuals, especially the restore form, before signing.

The export-documentation questionnaire blocker is resolved: Roman excluded France; the live Apple standard-encryption-outside-OS/FranceNo questionnaire returned no documents required. The corrected candidate uses Boolean ITSAppUsesNonExemptEncryption=NO with no export-compliance code, supported by that observed result and US-only scope. No ECCN, CCATS or other legal determination has been supplied or inferred. The immediate pre-upload GET-only guard must reverify exactlyUSA and no automatic territory expansion. Do not reuse rejected build5 or widen territory scope without reassessment.

Signing preparation must take source/gate pins from actual qualified receipts; the existing machine pins remain historical and inactive. This draft is not evidence of a signed, uploaded or installable build. Update accurate privacy/review metadata only for the qualified replacement, then verify exact TestFlight build/group access before pursuing public submission. Keep the existing review in place until then. No agreement or legal attestation is authorized by this draft.
