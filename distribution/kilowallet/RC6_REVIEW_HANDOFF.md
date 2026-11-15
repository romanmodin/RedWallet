# RC6 App Store review handoff — prepared, not submitted

Candidate: romanmodin/kilowallet-ios 9dfdcf864e92bde8a1c04485ff93294d2b731965, tree 9cfff022ec43945f9705fc0a0d14a8c93f653aca. Checked November 15, 2026.

This handoff describes the exact RC6 candidate for the publisher. It does not change the current App Store submission, make an export-compliance determination, accept an agreement, or assert that a signed RC6 build has reached Apple. Keep the existing 1.0 review in place until an exact signed replacement build has completed qualification.

## Proposed review notes

Kilowallet manages Bitcoin on the BLAKE2b chain (XBT). It does not spend the user's on-chain SHA-256 Bitcoin balance. No account or sign-in is required. A reviewer can create an empty wallet to inspect the interface; existing recovery words and a financial transaction are not required.

The app includes on-chain coin controls, PSBT external signing, fee bumping, Kilojoin collaborative transactions, an on-device Lightning node, optional Ark services, and PAY THROUGH JOINBLAKET. JoinBlaket is available for one payment to a native SegWit (bc1q) address. Kilowallet acts as a JoinMarket taker and selects makers with verified fidelity bonds. Before the user confirms, the app shows the makers' fees, estimated mining fee, and a fee ceiling. The app checks maker bonds and transaction inputs through the selected Electrum server with SPV proofs, checks each maker signature, and signs its own inputs only after the transaction and current wallet policy pass again.

The SEND screen refreshes a read-only market summary every 30 seconds from https://mempool.kilombino.com/joinblaket/market.json using the platform HTTPS client. The published summary contains aggregate offers and bond values; source comments state that it contains no maker nicknames or bond UTXOs. An actual JoinBlaket payment uses the app's Tor engine to reach the directory's onion service. If Tor cannot provide the directory connection, the payment does not fall back to a direct directory connection.

A JoinBlaket payment needs an eligible wallet coin with at least five confirmations and at least 20 percent of the payment amount. The feature keeps used PoDLE commitment history in wallet preferences and includes that history in the user's password-protected backup so commitments are not reused. A running payment reserves its selected coins and change address from other sends and Kilojoin rounds. Pending, reserved, frozen, wallet-change, server-change, signature, fee-ceiling, and broadcast guards fail closed.

iOS does not provide a continuous background service for these rounds. Kilowallet asks for the short background execution time iOS permits, but the user is told to keep the app open until the JoinBlaket payment finishes. A signed transaction that could not be broadcast remains pending and may still be rebroadcast; the app blocks conflicting work until the pending state resolves.

With Tor running, Kilojoin uses an onion relay or a public relay routed through Tor; if both routes fail it does not fall back to direct transport. With Tor off, Kilojoin may connect directly. The optional Lightning bridge uses HTTPS through Cloudflare in this candidate, even when the Lightning node itself uses Tor. The bridge operator handles swaps to SHA-256 Lightning invoices. Ark is a separately operated service.

Users can export a password-protected backup containing recovery material and, where applicable, Ark data, a static Lightning channel backup, and JoinBlaket commitment history. Exports can leave the device at the user's direction. A separate Lightning move file can contain live channel state. Local authentication protects recovery-secret access; do not describe all data as never leaving the device.

## Source and test evidence

- JoinBlaket.kt binds the market preview to JoinBlaketMarket.URL_MARKET, refreshes it on the SEND screen, reserves one operation before authentication, rechecks wallet identity and policy around suspensions, keeps keys only in the request, and wipes them when the round ends.
- Market.kt defines the HTTPS aggregate market endpoint and states that its response has no maker nicknames or bond UTXOs.
- IosPlatform.kt opens the JoinBlaket directory through Tor's SOCKS port and grants only iOS background-task time. The screen tells users to keep the app open.
- The native run is exact source 9dfdcf864e92bde8a1c04485ff93294d2b731965. Current-attempt unit and simulator reports contain 780 aggregate executions, zero failures and zero errors; two duplicated copies of the optional live-directory test are expected skips because the live-network flag was not enabled.
- Native runtime evidence verified Ark backup restoration, LND-over-Tor, the exact onion peer, watchtower registration, empty static-channel-backup RPC, CoinJoin relay through Tor, Tor startup, and Electrum fail-closed behavior. The unapproved Electrum TLS fingerprint caused the connection to stop before application data was sent; this is not evidence of a successful native balance scan.
- All 76 current screenshots were decoded and manually reviewed. JoinBlaket screens cover the market/TLS failure state, fee plan, foreground progress, synthetic result, eligibility guard, Spanish send/plan, and Chinese synthetic result.
- Migration fixtures for 0.4.0 to 1.0 and 0.4.1 to 1.0 passed four checks each against exact source 9dfdcf864e92bde8a1c04485ff93294d2b731965. They use synthetic wallets and leave production wallets untouched.

## Limits and publisher checklist

- RC6 has not been installed on a physical iPhone and no real JoinBlaket payment or other financial transaction has been performed. The result screenshots use a synthetic transaction identifier.
- The optional read-only live directory test did not run in the current native job. Do not claim that CI completed a real directory round.
- No funded Lightning-channel recovery, physical-phone background test, or completed live Kilojoin round is asserted.
- Current app-repository APP_REVIEW_NOTES.md, RC2_SERVICE_PRIVACY.md, and PRIVACY.md predate JoinBlaket. Use this source-backed handoff when reconciling the live review notes and privacy answers; do not copy historical privacy answers without checking the exact live fields.
- Verify the final signed source receipt, IPA and archive hashes, Apple processing, exact beta groups, external beta approval, installability, privacy fields, review metadata, screenshots, and export-compliance status before replacing the submitted build.
- Do not accept new agreements, make unsupported legal attestations, delete a public version, withdraw another app, or remove the current review before the replacement qualifies.

## Pending exact replacement receipts

The unsigned native Release artifact and protected signed upload are still pending. Fill this section only from current-attempt receipts after the native run completes and the protected publisher workflow succeeds.
