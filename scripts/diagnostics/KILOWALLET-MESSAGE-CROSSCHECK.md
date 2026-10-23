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
