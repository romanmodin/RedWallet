# Recovery discovery, server resilience and wallet lifecycle

## Behavior

Recovery remains manual by default. The explicit search option checks XBT BIP84 Native SegWit and BIP86 Taproot accounts 0–2 or 0–9. Each account scans receive and change independently, stopping after 20 or 100 consecutive unused addresses. Historical activity counts even if the balance is zero. There is a hard limit of 10,000 addresses per branch; hitting it reports incomplete recovery. No finite gap/account search guarantees discovery of the entire derivation tree. Wrong passphrases can produce valid but unused accounts.

Public-account imports cannot derive other hardened accounts or a different script format. They search only the supplied account with the selected address gap. Offline mode supports manual import; history discovery requires the configured XBT server. Missing, malformed or failed history responses fail rather than count as unused. Search cancellation and errors do not automatically save a wallet, and the UI distinguishes incomplete scans from completed searches without activity. Completed seed-discovery results require explicit selection and import.

Backups are explicit opt-in TLS endpoints, separate from server history. Maximum five, tried in saved order after the primary; no built-in public server and no automatic plaintext downgrade. Every endpoint must pass the XBT checkpoint check and normal TLS verification. Custom PEM certificates stay attached to their endpoint. Settings test a server before adding it. Changing backups, resetting or disabling connections aborts pending connections. Handshake, checkpoint, header and history waits are bounded. These checks establish network compatibility; they are not full SPV or proof that a server is honest. Configured servers see the address queries.

Wallet encryption now copies transaction history into the destination cache before switching storage. A failed destination-cache copy leaves the original storage readable. Saving after wallet deletion removes obsolete transaction records from the active bucket cache. Parameterized Realm queries keep wallet histories separate.

## Automated coverage

Discovery regressions cover both formats, nonzero accounts after empty accounts, change-only and spent-out history, extended gaps, usage resetting the gap, malformed/missing responses, server errors, cancellation and the hard address cap.

Resilience regressions cover selected-backup failover, TLS-only validation, duplicate/invalid endpoints and configuration changes during handshake, in addition to the existing disable/disconnect, checkpoint and request/batch-limit lifecycle tests.

The software wallet lifecycle runs both formats through discovery, real wallet refresh methods, signing, simulated broadcast, RBF replacement, CPFP, confirmation refresh, encrypted restart, wrong-password rejection, failed cache migration, deletion and recovery. It replays recorded public Knots funding fixtures through an in-memory server adapter. It does not claim a fresh live-node acceptance run, live Fulcrum protocol integration or physical-device testing. Existing Knots golden-vector and cold-signing tests remain separate evidence.

## Local validation

84 unit suites passed: 787 passed, one inherited skipped test. TypeScript, ESLint on all changed source/tests, localization checks, Fastlane metadata validation and diff whitespace checks passed. Additional production history-response regressions are run separately before committing. New discovery controls are included in the existing native BIP86 restore/restart test, pending native qualification.

## Release status

Source qualification must complete before a signed Android or TestFlight release. Existing installed builds do not contain these changes until a subsequent native release is published.

## iOS release qualification follow-up — October 8, 2026

- [x] Inspect PR40 source `61b7c3f521809b3b12cb88d5e49d1ae00d9e2cc6`: unit/lint and Android pass; iOS run [37287278982](https://github.com/romanmodin/RedWallet/actions/runs/37287278982) fails the storage encryption/decryption case.
- [x] Retained failure screenshot shows the password populated, confirmation empty, and OK disabled. Both fields use `clearTextOnFocus`; the driver previously used `replaceText` before the confirmation field received focus, then `tapReturnKey` cleared it.
- [x] Extract the password driver for regression testing; focus each field before typing, matching the successfully exercised native lifecycle interaction. Retain every existing completion, encrypted restart, wrong-password, fake-storage and decryption assertion and deadline.
- [x] Reproduce the confirmation-erasure failure with a secure-field focus model, then pass all five driver regressions after correction. Full local unit suite: 85 suites, 795 passing tests, one inherited skip. Full lint/typecheck passes; changed-file lint is required without added warnings before commit.
- [ ] Qualify the replacement PR40 source with fresh unit/lint, Android UI and iOS UI gates. Lifecycle branch passes do not substitute for these release gates.
- [ ] Merge only after those gates pass; verify identical private/public production source; use the existing protected signing and same-artifact upload workflows; assign the verified build to the existing TestFlight groups and retain Apple's processing/testing receipt.

Owner authorized completion of the iOS update on October 8, 2026. This correction changes test code only. The separate lifecycle branch remains separate; no physical-phone or cold-device interoperability is claimed. A passing test run is not evidence of TestFlight availability.

## USDC display and automatic market refresh — October 8, 2026

- [x] Round the displayed USDC estimate to exactly two decimal places using decimal half-up rounding. Keep XBT coin amounts, transaction amounts, stored rates and underlying estimate arithmetic at their existing full precision.
- [x] Refresh a saved NeoxEX quote on launch and on returning to the foreground, then recalculate the displayed total. Preserve explicit manual/cleared choices; coalesce concurrent refreshes; reject late responses after a newer choice or unmount; retain the last valid quote and actual trade timestamp when the exchange is unavailable.
- [x] Pass 30 focused price/fiat-safety checks, including rounding, recalculation, foreground refresh, offline preservation and response races.
- [x] Inspect replacement-source UI failures: Android retained the deliberately wrong password before typing the correct one; iOS retained pending native navigation while the driver held synchronization disabled. The iOS timeout hierarchy still showed the password field; the immediately following screenshot, after synchronization was restored, showed the wallet destination.
- [x] Add three failing driver regressions, then pass all eight after clearing focused secure inputs and restoring iOS synchronization immediately after submission. Existing UI assertions, deadlines and failure propagation remain unchanged; no blind resubmission.
- [x] Full local validation: 86 suites, 809 passing tests and one inherited skip; TypeScript and lint pass (one inherited no-bitwise warning in an untouched encryption test).
- [ ] Complete fresh exact-source hosted qualification for this combined app/test change, then continue the guarded iOS delivery process above.

The earlier test-only source mapping is superseded by these app changes. Recompute and verify the private/public production tree before signing. No updated TestFlight availability is claimed until Apple's receipts are verified.
