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

## Full upstream participant rounds

`run-peer.py SOURCE KOTLINC JAVA JSON_JAR` verifies pinned sources and compiles the
original upstream PoolSession, Protocol, BlindRsa, NIP44, event and crypto sources.
The org.json:json:20250517 JAR from Maven Central is SHA256-pinned by the runner.
`RelayClientStub.kt` replaces only networking with a signed-event stdio test relay;
`Peer.kt` supplies synthetic chain observations and public fixture keys. No public
relay, production node or real funds are used. The upstream creator's automatic
signing uses only its public fixture key; RedWallet still requires explicit approval.

Both P2WPKH and P2TR complete join/welcome, roster, close vote, RSA blind issuance,
fresh-identity output registration and signature exchange, then compare the exact
assembled transaction bytes. The test caught a pre-welcome subscription ordering
issue; the app now subscribes to the direct inbox first and to pool history only
after installing the welcome key. Kotlin sources remain unchanged.

## Disposable XBT node qualification

Run `KILOJOIN_REGTEST_BIN=/absolute/bin-directory node_modules/.bin/jest
 tests/native/kilojoin/regtest.test.ts --runInBand` (one shell line).
The directory must contain XBT-capable `bitcoind` and `bitcoin-cli` binaries.
An optional `KILOJOIN_REGTEST_RECEIPT=/absolute/output.json` captures results.

The test always creates a fresh temporary data directory, disables peer networking,
binds RPC only to loopback, verifies BLAKE2b activation at height 150, funds public
fixture keys, and checks/mines both script types' transactions. It rejects corrupted
signatures, confirms one mined block, stops its own process and removes its directory.
No existing node data/configuration is used. Both node cases passed on Knots
v29.4.2.knots20260508, bitcoind SHA256
`d04cd8211e711af989a7a62d0b8b55a8cfe496694392518da0ccb848469b3799`.

These are separate protocol and node tests: the complete Kotlin round currently uses
synthetic chain observations. Native UI/Keychain, actual WebSocket transport,
combined full-round/backend faults and Android JNI remain outside this qualification.
Both integration tests skip unless their explicit environment variables are supplied.


## Kilowallet 1.2.0 / Kilojoin v4 combined qualification

`run-peer-v4.py` uses unchanged upstream Kotlin sources pinned to Kilowallet
v1.2.0 commit `6fbff814de8a59d6c4879724bcb1ae772182a0f1` and verified by
`peer-v4-source-sha256.json`. Supply its `app/src/main/java/com/kilombino/pyblockwatch`
directory, the compiler, Java and JSON jar as for `run-peer.py`.
Set `KILOJOIN_REGTEST_BIN` and `KILOJOIN_V4_RECEIPT` to enable the combined backend
and write an actual receipt. Without the node flag, chain observations are synthetic.

Six cases cover one-output v3 and two-/five-output v4 on P2WPKH and P2TR. RedWallet
uses actual loopback WebSocket connections, with a separate connection for every
mixed output. Kotlin's networking adapter bridges signed encrypted events through
stdio; its original PoolSession and cryptography run unchanged. Both participants
check the disposable node's UTXOs. Kotlin broadcasts only public-fixture transactions
to that same isolated node; the test compares exact bytes and mines one confirmation.
Node peer networking is disabled, RPC is loopback-only, binary SHA256 is pinned,
and each fresh data directory/process is cleaned up. No production node or real
wallet is used. This does not establish physical-phone or public-relay availability.
