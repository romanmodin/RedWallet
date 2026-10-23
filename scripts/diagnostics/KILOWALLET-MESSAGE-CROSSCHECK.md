# Offline Kilowallet message cross-check

Reference: https://github.com/Kilombino/kilowallet at
`233733def7e492084f4d57e5faa1d76b9ab2ce79` (Apache-2.0).
The reference checkout was tracked-clean. No upstream files were modified.

Compiled actual upstream `Nip44.kt`, `NostrEvent.kt`, `Hashes.kt`, `Ripemd160.kt`,
`Secp256k1.kt`, `NativeSecp.kt`, `Ecdsa.kt`, `Schnorr.kt`,
`XChaCha20Poly1305.kt`, and `ark/ArkNative.kt` using Kotlin 2.3.10 with
org.json 20250517 on the JVM. The Android native Ark library is absent, so the
upstream's own JVM crypto fallback ran. No crypto or networking mocks were used
in fixture generation. No network connection, wallet, funds or real keys were used.

`KilowalletMessageVectors.kt` generates `tests/unit/fixtures/kilojoin-kotlin-messages.json`.
All scalar keys and tokens in this generator are public disposable test constants.
It checks reference decrypt and signature verification before emitting vectors.

Reproduction, with `$UPSTREAM` pointing to that exact clean checkout and `$TOOLS`
containing kotlinc and json.jar:

```bash
SRC="$UPSTREAM/app/src/main/java/com/kilombino/pyblockwatch"
"$TOOLS/kotlinc/bin/kotlinc" "$SRC"/crypto/{Hashes,Ripemd160,Secp256k1,NativeSecp,Ecdsa,Schnorr,XChaCha20Poly1305}.kt "$SRC/ark/ArkNative.kt" "$SRC"/coinjoin/{Nip44,NostrEvent}.kt -cp "$TOOLS/json.jar" -d "$TOOLS/reference.jar"
"$TOOLS/kotlinc/bin/kotlinc" scripts/diagnostics/KilowalletMessageVectors.kt -cp "$TOOLS/reference.jar:$TOOLS/json.jar" -include-runtime -d "$TOOLS/generator.jar"
java -cp "$TOOLS/generator.jar:$TOOLS/reference.jar:$TOOLS/json.jar" KilowalletMessageVectorsKt > tests/unit/fixtures/kilojoin-kotlin-messages.json
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/unit/xbt-kilojoin-kotlin-messages.test.ts
```

The fixtures cover eleven NIP-44 padding boundary lengths, exact encryption bytes
and decryption, ECDH in both directions, actual signed welcome/roster/vote/blind-signature
envelopes, tampering rejection and replay rejection. They test message envelopes,
not full roster contents or a complete live round. Upstream Schnorr auxiliary
randomness means regenerated event signatures need not be byte-identical.

Separately, session tests drive the real RedWallet relay queue through an offline
socket with immediate roster, vote and closing events while chain checks wait,
for one and five outputs. Both pass. Direct concurrent session calls bypass the
production relay's serialization and fail by design; this is not a demonstrated
production race. Chain observations in these session tests remain simulated.

Remaining unproven on-device causes include a specific rejected roster/proof or
chain observation, replay ordering on a real connection, and iOS runtime behavior.
No result here establishes why the reported physical-device attempt failed.

## Roster, ownership and fee extension

`KilowalletRosterVectors.kt` uses the same pinned upstream checkout, additionally
compiling unmodified `coinjoin/CoinjoinTx.kt`, `Protocol.kt`, `BlindRsa.kt` and
`crypto/Address.kt`, `Base58.kt`, `Bech32.kt`, `Bip32.kt`, `TxBuilder.kt`.
Compile these with the prior source list into `roster-reference.jar`, then compile
and run `KilowalletRosterVectorsKt` using the same classpath recipe.
The output is `tests/unit/fixtures/kilojoin-kotlin-rosters.json`.

The 640 fee/change cases cross both script types, outputs 1–5, inputs 1/2/8/10,
fee rates 1/1.25/2/500, and four insufficient/exact/dust-boundary input values.
Twelve actual upstream seat encodings cover both script types, outputs 1/2/5,
and single/multiple inputs. RedWallet verifies actual Kotlin ownership signatures,
script derivation and change commitments, and rejects altered amounts/identities.
These are reference-code interoperability checks, not independently observed
chain coins or a complete live pool. All inputs are disposable synthetic data.

## Actual pool state-machine exchange

`KilowalletSessionHarness.kt` compiles the unmodified upstream `PoolSession.kt`
into the SAME module as the prior source list (its internal functions require this).
Add `OfflineRelayClient.kt` and the harness to that compiler invocation, use
`-include-runtime -d /tmp/redwallet-kotlin-tools/session-harness.jar`, then run:

```bash
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath scripts/diagnostics/kilowallet-session.test.ts
```

The harness replaces only RelayClient's socket/acknowledgment transport. No live
connection exists. It calls the actual PoolSession event handler and uses actual
Kotlin crypto, roster, ownership, fee, voting, blinding and output code.
Chain observations/persistence are synthetic and the native Ark library is absent.
Broadcast is prohibited by the harness. Keys/coins/state are disposable test data.

The 12 cases span both script types, 1/2/5 outputs, and 2/5 participants.
Two-participant cases use two inputs and reach unsigned transaction review.
Five-participant cases use one 35-million-sat input, 3-million-sat denominations
(up to 15 million total), and reach accepted blind signatures and separate output
submissions. Three seeded participants have authenticated test votes generated
through Protocol.mac and processed through the actual event handler; their output
submissions are intentionally pending. The five-participant case does not claim
completed mixing or transaction review. Seeded joins themselves are generated by
actual PoolSession.sendJoin.

The same accepted RedWallet join replayed to the actual creator creates no extra
seat or reply. Recorded actual messages replayed into RedWallet preserve its
replay rejection and reservation invariants. The deliberately short legitimate
pool scalar 2 exercises the earlier welcome compatibility fix.

Initial full-pool harness assertions expected closing without the seeded peers'
votes. The real creator correctly waited; authenticated synthetic votes were
added. No production rule was changed to make these tests pass.

Generated exchanges are copied from /tmp/redwallet-actual-session-vectors.json to
`tests/unit/fixtures/kilojoin-kotlin-session.json`. The regular unit suite replays
24 initial/closing and replay-boundary checks from these actual exchanges. Fresh
blinding randomness means the recorded blind signature cannot authenticate a new
blinding request; full blinding/output interoperability is verified by the manual
live-process harness above. Neither test exercises iOS/Hermes or real chain data.


## Immediate startup order and state fingerprints

`tests/unit/xbt-kilojoin-startup-order.test.ts` uses the production relay and
session with an offline socket and actual recorded Kotlin creator envelopes.
Its callback mirrors MixingClient's direct-welcome to pool subscription switch.
NIP-01 initial history with a limit is timestamp descending, then event ID
ascending: https://github.com/nostr-protocol/nips/blob/master/01.md.

Before correction, all 12 chronological exchanges passed; forcing vote before
roster failed in all 12. The specified history sort produced that failure in
7 of the 12 fixed recordings. These tests reproduce a startup defect; they do
not prove that the actual relay delivered the user's attempt in that order.
The failed vote left phase OPEN, whereas the user's screenshot says JOINING.
A welcome persistence failure leaves JOINING with zero seats. A later chain
failure leaves OPEN with zero seats; a duplicate accepted roster leaves OPEN
with its accepted seats. The controller does not reset those states to JOINING.
A welcome arriving before the join publication acknowledgment waits correctly.

The correction retains at most one authenticated initial vote. It cannot cause
voting, publishing or signing until the complete roster, input proofs, chain
observations, own seat and caller membership pass. Roster and voting state are
saved atomically. The original vote time/deadline and strict replay rejection
remain; conflicting pending votes fail closed. This is not general history
reconciliation or automatic retry. New KJ-STORAGE/KJ-DECRYPT diagnostics avoid
exposing native storage errors, payloads or keys.

The native self-test now calls `startup-self-test.ts`: exact actual-envelope
subsets for both script types, five seats and five outputs are packaged in
`startup-self-test-vectors.json`. Each runs chronological and reversed order,
using real native crypto/vault code when executed on iOS. It uses a fixed test
clock and independent known synthetic coin map, never the wallet or backend.
It rejects replay and verifies no transaction was signed. Only its unique
storage/keychain records are deleted. The generator source for known peer coins
is `KilowalletSessionHarness.kt` at the pinned upstream revision above.
The Node-hosted self-test passed; native iOS execution remains REQUIRED.

Evidence and actual before/after log hashes:
`.github/release/IOS-KILOJOIN-STARTUP-ORDER-20261023.json`.
