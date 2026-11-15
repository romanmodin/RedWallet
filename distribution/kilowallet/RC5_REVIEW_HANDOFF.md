# RC5 App Store review handoff — prepared, not submitted

Candidate: romanmodin/kilowallet-ios 68148c8c5741c7b84b37f33322e67273f7208a19, tree 9feb8f8d99f115c6bb9d10cd2c08358cc5543484. Checked November 13, 2026.
The replacement signed build and both intended TestFlight groups are now qualified. Before changing the current App Store submission, inspect its exact build association, privacy fields, review metadata and screenshots. No new legal or encryption determination is made here.

## Proposed review notes

Kilowallet manages Bitcoin on the BLAKE2b chain (XBT). It does not spend the user's on-chain SHA-256 Bitcoin balance. No account or sign-in is required. Create an empty wallet to inspect the interface; reviewers need not supply existing recovery words or make a purchase.

The app includes on-chain coin controls, PSBT external signing, fee bumping, Kilojoin collaborative transactions, an on-device Lightning node and optional Ark services. Kilojoin includes protocol v6 asynchronous rounds: participants may respond at different times and stored round state supports resuming. This does not mean iOS keeps the app running continuously in the background. Users still review and sign their own inputs; pending and reserved-coin guards apply.

With Tor running, Kilojoin uses an onion relay or a public relay routed through Tor; if both routes fail it does not fall back to direct transport. With Tor off, it connects directly. The optional Lightning bridge uses HTTPS through Cloudflare in this candidate, even when the Lightning node uses Tor. The bridge operator handles swaps to SHA-256 Lightning invoices. Ark is a separately operated service.

Users can export a password-protected backup containing recovery material and, where applicable, Ark data and a static Lightning channel backup. Exports can leave the device at the user's direction. A separate Lightning move file can contain live channel state. Local authentication protects recovery-secret access; do not describe all data as never leaving the device.

## Evidence and limits for the publisher

- Protocol.kt defines V6 and asynchronous timing/terms; PoolSession.kt persists/resumes v6 state. AsyncRoundsTest.kt and AsyncRoundsE2ETest.kt test it with synthetic transports. Source support and unit tests do not prove a completed funded live pool or physical-phone background operation.
- Lightning.kt explicitly sets Bridge.torPort to null. Retain the HTTPS/Cloudflare disclosure.
- Current PRIVACY.md describes service data and operator-reported retention. Do not automatically reuse the historical “Data Not Collected” answers.
- docs/APP_REVIEW_NOTES.md and docs/RC2_SERVICE_PRIVACY.md still contain obsolete v1–v5/no-v6 wording. Use the source-backed correction above for RC5 submission; historical 0.4/RC3 notes are not current metadata.
- Actual screenshots must correspond to the final qualified build. Current CI screens include synthetic fixtures; TLS-warning screens are not proof of a trusted Electrum scan.
- Current-attempt full native43260800743/a2 passed431tests, eight runtime checks and unsigned device Release; strict visual43336731222/a1 plus corrected Receive43372119378/a1 qualify exactsource68148c8. Original failed captures remain documented.
- No funded-channel recovery, physical iPhone installation, or completed live Kilojoin transaction is asserted.
- Verify actual Apple build processing, beta approval/group membership, privacy fields, review metadata and export-compliance status before submission. Do not accept new agreements or make unsupported legal attestations.

## Qualified replacement receipts

- Version1.0.0 build15; Applebuild964f117a-f5e1-400f-9aac-d3145407560a.
- Signed upload43394532491/a1 at orchestrationb7364b58c09238266a3b2fe248f0000b3b82c62b. IPA SHA256b09b7c9eab7c63a7697d5604b91ab82d83e60ff55c03d54e6d9acdc9ab12f7de.
- Upload receipt artifact14023907293 SHA25662808e4c1c9f3978ae65c8b056814db6b5bcf7d28da2fb02c64a8c30e191b497 verified.
- Distribution43401919536/a1 at105553dd5b309ca5251d3e13e066fbdbe12d82a9 verified both original group memberships in both directions, beta reviewAPPROVED, internal/externalIN_BETA_TESTING, AVAILABLE_TO_TESTERS at2026-11-13T09:32:20.790Z. Artifact14025930506 SHA2567dbe996ded45c719c69375fcd8881e13ca55131251e72b6c6d631f5d4958db7d verified. No physical-device installation claim.
- Last App Store GET-only observation09:30:21.746Z: version1ca23695-4563-4a0e-b20e-d1a6457f4f8b stillWAITING_FOR_REVIEW, USAonly/noautoexpand. This generic preflight does not establish current review-build association or privacy answers. Existing review has not been withdrawn or replaced.
- Next: inspect live review-build/privacy/review-detail/screenshots; reconcile against current source-backed notes above before the authorized replacement submission. Do not delete a public version, affect another app, accept agreements or reuse unsupported privacy/legal answers.
