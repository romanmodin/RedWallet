# RC5 App Store review handoff — prepared, not submitted

Candidate: romanmodin/kilowallet-ios 68148c8c5741c7b84b37f33322e67273f7208a19, tree 9feb8f8d99f115c6bb9d10cd2c08358cc5543484. Checked November 12, 2026.
Do not replace the existing review until the replacement signed build qualifies and its intended TestFlight groups can access it. No new legal or encryption determination is made here.

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
- Full native 43227455762 passed, but later 43260800743 failed onion-peer verification; its unsigned iphoneos Release succeeded at 18:53:19Z. Focused 43280703098 is pending. Do not claim replacement readiness based only on the older pass.
- No funded-channel recovery, physical iPhone installation, or completed live Kilojoin transaction is asserted.
- Verify actual Apple build processing, beta approval/group membership, privacy fields, review metadata and export-compliance status before submission. Do not accept new agreements or make unsupported legal attestations.
