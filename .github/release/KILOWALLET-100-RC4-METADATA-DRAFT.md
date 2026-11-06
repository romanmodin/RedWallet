# Kilowallet 1.0 RC4 — replacement metadata draft

Prepared November 5, 2026 against publisher app source `68461ec5b6d5bde5a92533a78b15a6594605cb2f`. This is a draft for the qualified replacement build. It has not been submitted to Apple. The existing 0.4.0 review and its metadata remain in place. The currently checked-in app review notes still describe RC3/v1–v5 and must not be copied unchanged for RC4.

## Proposed description

Kilowallet is a self-custodial iPhone wallet for Bitcoin on the BLAKE2b chain (XBT). Create and restore wallets, receive payments with QR codes, and review amounts and network fees before sending.

Manage multiple wallets, watch-only wallets and individual coins. Use SegWit or Taproot, export transactions for external signing, and increase the fee of an eligible unconfirmed transaction. Recovery words are stored in the iOS Keychain. Back up your recovery words securely.

Kilojoin pools let compatible wallets build a shared transaction. Your wallet checks its outputs, change and fees before you approve signing. Asynchronous v6 pools retain their progress so you can return and continue later. You must reopen the app and respond before each deadline; iOS does not keep the round running continuously in the background. If you create a pool on the iPhone, keep the app open while it runs the pool. CoinJoin is experimental and does not guarantee anonymity.

The Lightning view runs a node on the iPhone. Open and manage channels, pay and receive Lightning invoices, and use a watchtower over Tor. An optional operator-run bridge pays a SHA-256 Lightning invoice using XBT; review the quote before approving. Channel funding, available liquidity and connectivity affect what can be paid or received.

Ark is an optional network service with its own operator, terms, recovery requirements and privacy practices. Password-protected backups can include wallet recovery material, Ark data and a static Lightning channel backup. Keep backup files and their passwords secure.

Configure your Electrum server and Tor preferences. Network transaction fees apply. This app operates on BLAKE2b XBT; its on-chain balance is separate from SHA-256 Bitcoin.

Created by Kilombino. This iOS distribution is maintained by romanmodin with the author’s permission.

## Proposed review notes

This is an upgrade of the existing Kilowallet app, bundle `com.kilombino.kilowallet`, version1.0.0, build8 (Apple build efc0adfd-12df-4c95-8fa5-479b1e516563). Its exact publisher source is 68461ec5b6d5bde5a92533a78b15a6594605cb2f; signed IPA SHA256 afb6ddb5f9685eacb0256c62cdeea76731739f823c43fa34a1c8eef596ae582d. No account or app login is required. Create a new empty wallet to inspect the on-chain, Kilojoin, Lightning and Ark views. Reviewers should use synthetic/demo material and should not enter recovery words from a funded wallet. Watch-only import supports inspection without signing or access to the corresponding private keys.

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

## Current qualification and activation

As observed November5 at5:45PM Pacific (01:45:17Z November6), signed1.0.0build8 is AppleVALID, assigned to both original groups with build-side and group-side memberships verified. Kilowallet Internal is IN_BETA_TESTING. Kilowallet Public Beta is WAITING_FOR_BETA_REVIEW with one submitted beta review WAITING_FOR_REVIEW; do not claim general tester availability yet. Accurate RC4 beta notes were saved. Distribution run42145781307/attempt1 and verification artifact13468614453 SHA122bfea21050f29bc2aa399eb3619207edb12fd83a462bbb0b42c6516459a4c8 bind exact source, Applebuild and IPA.

Current native42112589802/attempt1 and checker42112589904 passed. Ten exact synthetic migration/isolation checks passed; all68actual simulator frames, runtime evidence and arm64Release build were inspected.429uniqueXMLrecords had no failures/errors/skips (four optional external no-ops excluded from425executed claim). Certificate-rejection/height0 Electrum frames are not successful scan evidence. Physical iPhone reliability, funded-channel recovery, accepted watchtower justice backups and live pool completion remain unverified.

Protected signing/upload42137139153/attempt1 completedSUCCESS at00:59:48Z. Exact appsource684 and orchestration2688 were bound into archive/package/native/USA/Appleprocessing receipts. Signed package uses SDKiphoneos26.2/teamPPG9C98EY9/bundlecom.kilombino.kilowallet/Booleanfalse encryption flag with no export code. Verificationartifact13466843473 SHAb8eb96610d84e3d6f56f444c14b2458f1e51ad952745fb00038a577cc48e9572 and encryptedIPA13467166697 SHA0655c4f8076f254bdc38e4d364387567d4180f1bee0564f144e81b1a7db9f6a0 were APIhash/CRC verified. No identity downloaded.

Fresh GET-only Apple public preflight42144736741 observed01:35:07Z: existing0.4.0version1ca23695-4563-4a0e-b20e-d1a6457f4f8b remainsWAITING_FOR_REVIEW. USA-only availability and disabled automatic territory expansion remain intact. That preflight's oldbuild3 status is historical; build8 facts come from exact beta readback. No public review, privacy labels or store metadata was changed by the beta assignment.

The export-documentation questionnaire was resolved by the observed standard-encryption-outside-OS/FranceNo/no-documents-required result and Roman's France exclusion. No ECCN, CCATS or formal legal determination is asserted. Do not change that scope or accept new agreements. No encryption declaration was created, attached or modified by distribution.

Next: preserve the pending beta review. Once exactbuild8 is approved and both groups are IN_BETA_TESTING, reverify live public review state and apply accurate replacement review/privacy metadata without deleting public versions or withdrawing other apps. These proposed store/review texts remain unsubmitted. An App Store release cannot be called available based on beta assignment.

## November5,6:30PM Pacific — public-release recheck required

Fresh GET-only exactbuild8 beta inspection42150216129/a1 observed02:26:16Z: both original memberships remain verified, Internal IN_BETA_TESTING, Public Beta WAITING_FOR_BETA_REVIEW/reviewWAITING_FOR_REVIEW. No writes or resubmission. Resultartifact13472580873 SHAe60b83b7ab8a78843b2ce604051a20e22c8856ca56e433fc8f2dfbb7832f9f57 APIhashCRC verified.

The automatic post-merge native run42136946441/a1 failed Ark readiness after300s (sample main thread idle; Ark log empty) and device compilation failed downloading Maven dependencies (repo.maven.apache.org resolution). It tested mergee9aae6502f3a8a1aa7703424540d5a568214fa5e with the same qualifiedb85 source tree. Do not infer an Ark root cause or claim this run passed. Earlier qualified684 native/source/package receipts remain historical exactbuild8 evidence, but public advancement is held until this later readiness failure is resolved/rechecked.

All firstattempt logs, reports13469293187 SHA14cf7fdb926f5fb0b0a930ec6c7480b3ba5d10dc957a8ce7f0a7329d65b8f593 and release-build-log13468629753 SHAe64e13827bfd3e547cafc2c5d3be21dc193c8576ecdf65aebf5c86047f7df658 retained and APIhashCRC verified. Screenshotartifact was not preserved; subsequent retrieval returned404 after rerun. No visual claim for the failed Ark frame.

After verifying no healthy app duplicate and the exact same source tree, requested ONE existing-run rerun. Current42136946441/attempt2/job127672233917 IN_PROGRESS; no source edits, timeout changes, re-signing, re-upload or healthy cancellation. Collect currentattempt2 outcome and Ark/native evidence before public submission. Preserve existing0.4review and pendingbeta review. ETA2–4hours for verification conditional on runner/services; Apple beta/public review timing is separate. No new scheduled automation, legal agreement, financial transaction or production wallet access.

## November5,8:35PM Pacific — rerun runtime/device pass; LND frame recapture pending

Currentmain native42136946441/attempt2/job127672233917 SUCCESS. APIhash/CRC verified allthree artifacts; actualcheckoute9aae650/treeb85 equals signedsource684. All429uniqueXMLrecords have zero failures/errors/skips; eight runtime checksPASS, Arkbackup-roundtripPASS, arm64ReleasePASS. The earlier Ark readiness and Maven failures did not recur on unchangedsource. No successfulElectrumscan/physicalphone/fundedrecovery claim.

All68screens reviewed through contact sheets; full-resolution Restore04/Ark52 render correctly. Full-resolution LND55 has visibly missing textglyphs, so visualApproval/publicAdvanceApproved remainfalse. Preserve the actualPNG and qualification-decision.json rather than calling every screenshot clean. A focused syntheticln-live-only diagnostic is dispatched on publisherbranch diagnostic/lnd-frame-build8-20261105, orchestration68027fdb483e48d8f2e6ee9ffb9f53764d4eb029, checkingout unchangedappsourcee9/treeb85. It uses existingci-screenshots.sh ONLY=ln-live and three laterframes without changing wallets/engines/rendering/productioncode. NoPR/mainmerge/re-sign/re-upload; fullnativegates unchanged. Inspect actualrecapture before publicadvancement. ETA45–90minutes conditionalonrunner/connectivity.

FreshbetaGET04:29:22Z confirms InternalIN_BETA_TESTING and externalWAITING_FOR_BETA_REVIEW, originalmemberships bothdirections. No resubmission/publicmutation. Preserve existingreview and waitforactualApple approval and visualevidence. This supersedes earlierArk/Maven-pending wording only; legal/privacy/public-state guards remain.
