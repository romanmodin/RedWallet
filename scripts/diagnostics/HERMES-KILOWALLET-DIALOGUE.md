# Actual Hermes participant and Kotlin creator interoperability

This extends the welcome-decoding diagnosis in `HERMES-KILOJOIN-STARTUP.md`.
The production app code is unchanged from the one-line decoder correction at
`628a0c6ecdeabc8b9b49093d2b9fd66f4e536c3f`.

The standalone Hermes engine is the exact iOS-pinned version
`hermes-v250829098.0.10` / `becc964bd16002569bf74c4d8c190cfd2ad38985`,
built for this Linux diagnosis host. Kilowallet is pinned to
`233733def7e492084f4d57e5faa1d76b9ab2ce79`; its actual PoolSession, protocol,
transaction, RSA and message crypto sources are compiled unchanged. The
diagnostic replaces the reference socket transport and chain/storage services.

## Exchanges

Compile `KilowalletSessionHarness.kt` and `OfflineRelayClient.kt` together with
the reference sources listed in `KILOWALLET-MESSAGE-CROSSCHECK.md`, using Kotlin
2.3.10 and org.json 20250517. Include the Kotlin runtime in the resulting jar.

Set `REDWALLET_ESBUILD_MODULE` to diagnostic-only esbuild 0.25.12,
`REDWALLET_HERMES_BIN` to the pinned engine executable, and
`REDWALLET_KOTLIN_CLASSPATH` to the compiled harness jar plus json.jar. Then:

```sh
node scripts/diagnostics/run-hermes-kilowallet-dialogue.cjs /tmp/kj-dialogue.json
node scripts/diagnostics/run-hermes-kilowallet-dialogue.cjs /tmp/kj-stress.json --stress
```

The host sends each actual Hermes-produced event to the Kotlin process and
returns the actual creator responses to Hermes. The standalone VM has no stdin
callback, so the host uses deterministic client replay between exchanges.
Every replayed request must match its previous SHA-256 exactly. The seeded
entropy is confined to this diagnostic; it must never be used in production.
The runner preserves synthetic transcripts and checks their hashes.

Normal coverage is P2WPKH/P2TR × 1/2/5 outputs × 2/5 participants: 12 cases.
Each reaches unsigned review through join, welcome, roster, vote, closing,
blinding, unblinding and separate output publication. Two-person cases use
multiple inputs. Five-person cases use one larger input with change and now
include **all** seeded participants' outputs. Each seeded member processes the
real closing and blind-signature messages using its actual Kotlin controller;
its isolated output hand-ins pass the actual creator verification. Seeded
votes remain authenticated synthetic votes sent through the real event handler.
The largest case has 25 mixed outputs, all present at review.

Checks also cover duplicate-join rejection by the creator, output delay,
isolated transport requests, distinct fresh output identities, own mixed
amount/count and change, changed-review rejection and spent-input rejection
before the diagnostic's prohibited spending signer can run.

Two additional five-person/five-output stress cases reverse the initial roster
and vote delivery. They submit authenticated synthetic-creator output lists
with a missing, replaced or duplicated output. Each must fail at the specific
validation check without advancing the session; the subsequent valid list
must still reach review. Replay and validation assertions are not relaxed.

## Encrypted storage and prepared native self-test

```sh
node scripts/diagnostics/run-hermes-native-probe.cjs /tmp/kj-storage.json
```

This runs the app's **unchanged** `runKilojoinNativeSelfTest` in actual Hermes.
Only native entropy, Keychain and AsyncStorage boundaries are replaced with
explicit deterministic/in-memory diagnostic implementations. Actual RSA,
XChaCha20-Poly1305, envelope serialization, SessionVault and startup controller
code execute. The check includes encrypted round-trip, ciphertext-tampering
rejection, five distinct blinded outputs and four actual Kotlin startup
fixtures (both script types, chronological/reversed order), each using the
encrypted vault. It requires cleanup and checks that secrets were not stored
as plaintext. This is deliberately **not** a native Keychain/iOS receipt.

## Observed result, 2026-10-23

All 12 normal exchanges and both stress exchanges passed, reaching review.
The storage/self-test probe passed: 16 writes, 12 reads, five keys created and
removed, no plaintext leak detected and no leftover test records.
Exact execution times, engine/bundle/transcript hashes and individual results
are in `.github/release/IOS-KILOJOIN-HERMES-DIALOGUE-20261023.json`.

No additional production defect was found in these stages. The earlier decoder
defect remains independently reproduced and corrected. These results do not
prove the phone's exact error, a native iOS Keychain write, real network timing,
verified live-chain observations, or a completed signed/broadcast round. No
real wallet, real coins, network connection, spending signature or broadcast
was used. Native iOS qualification and new TestFlight delivery remain separate.
