# Standalone Kotlin interoperability

Pinned upstream: Kilombino/kilowallet v1.1.6, commit
06e1ac9a346bd810db1749ca0b1048d0da980c35 (Apache-2.0).
`source-sha256.json` verifies every compiled upstream source byte. Fetch its `crypto`
directory and `coinjoin/CoinjoinTx.kt` into the layout described by that manifest.

Run the session test with `KILOJOIN_INTEROP_OUTPUT` pointing to a new, nonexistent
TSV file. Then run `run.py` with five arguments: source directory, Kotlin compiler
executable, Java executable, TSV, and destination JSON. Finally run
`tests/unit/xbt-kilojoin-kotlin.test.ts` against the generated fixture.

The harness compiles original Kotlin crypto and CoinjoinTx sources unchanged.
`ArkNativeStub.kt` disables unavailable Android JNI so upstream's own Kotlin
fallback executes. It verifies RedWallet signatures and exact raw transaction/txid
bytes, then returns Kotlin-produced signatures for RedWallet to verify. Both
P2WPKH and P2TR are covered using public test keys 1 and 2, without real funds.

Verified locally using Kotlin 2.2.20 and Temurin JRE 17.0.20.1+1.
Archive SHA256s checked against publisher sidecars:
- Kotlin compiler: 81f0264c9073b5cbbdb3ff8418cf2c5dac076879fc156fa1a6462f5a5acc4420
- Temurin JRE: 0b2b640e3046b64c8ec504de0ab9d91bb5610182bda21fad454681ce54d45a62

This is transaction/cryptography interoperability. It does not exercise the complete
Android PoolSession, Android JNI, relay round lifecycle, or a live XBT node.
