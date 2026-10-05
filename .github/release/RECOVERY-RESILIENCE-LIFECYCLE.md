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
