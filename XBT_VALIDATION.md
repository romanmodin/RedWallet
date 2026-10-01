# XBT validation record

## Knots transaction acceptance — passed 2026-09-28

The actual `XbtSegwitBech32Wallet.createTransaction` implementation signed two
ordinary P2WPKH inputs funded by Knots. The node accepted the transaction into
its mempool and included it in a generated block. Both signatures end in
`SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`).

| Check | Observed result |
| --- | --- |
| Node | Knots 29.4.2, tag suffix 20260508 |
| Isolation | Docker network `none`, no production data mounts, no published ports |
| Chain | Regtest; BLAKE2b active at height 150 |
| Funding | Ordinary confirmed transaction; 60,000 + 40,000 sats |
| Recipient / change | 90,000 / 9,786 sats |
| Fee / virtual size | 214 sats / 209 vbytes |
| Positive control | `testmempoolaccept.allowed = true` |
| Changed output | Rejected: `mempool-script-verify-flag-failed` |
| Removed Unified bit | Rejected: `mempool-script-verify-flag-failed` |
| Confirmation | One confirmation at regtest height 153 |
| Cleanup | Node stopped; temporary container removed |

Transaction ID:
`6fef0e2039d1a0fb78981c845d30b4b90560514bb892ebd6b1f86292ee8769c7`.

The complete public fixture, signed transaction, finalized PSBT, negative controls,
and node responses are in
[`tests/fixtures/xbt-knots-regtest-acceptance.json`](tests/fixtures/xbt-knots-regtest-acceptance.json).
Production signing code was unchanged from commit
`49e06af1fd115cf5bde7733cd8b258a98d9ee566`.

### Scope of this result

This validates two-input software signing and consensus acceptance on activated
Knots regtest. The harness supplies real parent transaction data through a mocked
wallet transaction-history accessor; it does not exercise Electrum history,
the phone send UI, live fee estimates, or broadcast through Fulcrum. It does not
prove mainnet operation, BTC-chain rejection, hardware interoperability, physical
iPhone behavior, or TestFlight readiness. No production funds were used.

### Reproduce

Requirements: this repository's installed Node dependencies; Docker and an
independently verified Knots BLAKE2b image on the node host. Use a separate
terminal for the foreground node. The two hosts may exchange only the public
JSON files described below.

1. Export the deterministic public address plan on the app host:

   ```sh
   XBT_KNOTS_PREPARE=1 XBT_KNOTS_RESULT=/tmp/redwallet-knots-plan.json \
     npx jest --runInBand tests/integration/xbt-knots-acceptance.test.ts
   ```

2. Start an isolated foreground node. Set `XBT_KNOTS_IMAGE` to your verified
   local image ID. The observed run used image
   `sha256:b54aac30c0a9568c0d19813c22560721ecf7d260c54ad082d35506a19b979e16`.

   ```sh
   docker run --rm --pull never --name redwallet-knots-regtest \
     --network none --memory 768m --cpus 1 --read-only --cap-drop ALL \
     --security-opt no-new-privileges \
     --tmpfs /regtest:rw,nosuid,nodev,noexec,size=384m,mode=1777 \
     --tmpfs /tmp:rw,nosuid,nodev,noexec,size=32m \
     --entrypoint /usr/local/bin/bitcoind "$XBT_KNOTS_IMAGE" \
     -regtest -datadir=/regtest -server=1 -listen=0 -networkactive=0 \
     -dnsseed=0 -discover=0 -testactivationheight=blake2b@150 \
     -corepolicy=0 -dbcache=64 -maxmempool=20 -printtoconsole=0
   ```

3. In a second node-host terminal define the isolated RPC helper, create a faucet,
   and mine through activation **before** funding. Scheduled Unified signing can
   start before consensus activation.

   ```sh
   knots() {
     docker exec redwallet-knots-regtest /usr/local/bin/bitcoin-cli \
       -regtest -datadir=/regtest "$@"
   }
   knots createwallet faucet
   faucet_address=$(knots -rpcwallet=faucet getnewaddress "" bech32)
   knots generatetoaddress 151 "$faucet_address"
   knots getdeploymentinfo
   knots getnetworkinfo
   ```

   Require chain `regtest`, `blake2b.active=true`, height 150,
   `networkactive=false`, and zero connections.

4. Fund the plan's two `regtestAddress` outputs with exactly 60,000 and 40,000
   sats. The `bcrt` encoding is used only by the node; scripts remain identical
   to the app's `bc1` outputs. An explicit fee avoids regtest's empty estimator:

   ```sh
   funding_txid=$(knots -rpcwallet=faucet -named sendmany dummy= \
     'amounts={"bcrt1qcr8te4kr609gcawutmrza0j4xv80jy8zeqchgx":0.0006,"bcrt1qnjg0jd8228aq7egyzacy8cys3knf9xvr3v5hfj":0.0004}' \
     fee_rate=1)
   knots generatetoaddress 1 "$faucet_address"
   knots -rpcwallet=faucet gettransaction "$funding_txid"
   ```

5. Build the fixture JSON from the returned real funding `hex` and
   `confirmations`, plus `getblockcount`:

   ```json
   {"chain":"regtest","blake2bHeight":150,"height":152,
    "fundingTransactions":[{"rawTx":"<funding hex>","confirmations":1}]}
   ```

   Transfer it to `/tmp/redwallet-knots-fixture.json` on the app host, then sign:

   ```sh
   XBT_KNOTS_FIXTURE=/tmp/redwallet-knots-fixture.json \
     XBT_KNOTS_RESULT=/tmp/redwallet-knots-result.json \
     npx jest --runInBand tests/integration/xbt-knots-acceptance.test.ts
   ```

6. Transfer the public result to the node host. Before submitting the good
   transaction, call `testmempoolaccept` separately for each negative-control
   hex and `goodHex` (each RPC argument is a JSON array containing one hex).
   Require both negatives to fail script verification and the good transaction
   to return `allowed=true` with `expectedTxid`.

7. Submit `goodHex` with `sendrawtransaction`, generate one block, and use
   `getrawtransaction <txid> true <blockhash>` to verify at least one
   confirmation. Record the exact responses. A passing Jest bridge alone is
   not a node-acceptance result.

8. Run `knots stop` and verify the temporary container is removed.

The integration bridge skips by default and never performs RPC or broadcasts.
Replaying the committed fixture through the signing bridge is useful for
checking deterministic signing, but does not replace a new isolated node run.

### Primary protocol reference

[Knots activated-fork functional test at v29.4.2.knots20260508](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/test/functional/feature_unified_sighash.py)
defines the activation parameters and Unified P2WPKH acceptance behavior.

## Live Fulcrum read path — passed 2026-09-28

The application network adapter connected from the development workstation to
its privately configured XBT Fulcrum server and verified the pinned checkpoint.
Knots independently reported mainnet height **974565**, no initial block download,
and this public, unspent P2WPKH output from that block:

- Transaction: `4daccb142526f1c60180b64d870d77dc61e83c8fe4784d6fc6e83c1249c11855`, output `0`.
- Address: `bc1q54xzx6f3882ecl42sa8q56celep09jhkuhmet4`.
- Value: **44,873,580 sats**; coinbase output.
- Block: `0000000000000000b8f4aad46643974a0bf557df02fb0a83a51f4c4bbc4263ee`.

The real `BlueElectrum` connection and batch history/UTXO/balance methods passed
against this output. The observed address had 392 history entries and 233 raw
UTXOs; the app reported tip 974565 and fee estimates of 2 sat/vB for each speed.
These are observations at test time, not current balances or recommended fees.
Raw UTXOs include immature coinbases; this test does not mark them spendable.
Coinbase selection remains covered separately by maturity tests.

The test uses the existing in-memory Jest preferences adapter and a real TCP
socket. It does not exercise iOS storage, a phone VPN route, wallet history
presentation, parent-transaction caching, spend selection, or broadcasting.
No private wallet was loaded, and no mainnet transaction was signed or sent.

Reproduce with a fresh public output independently checked using Knots
`getblock` and `gettxout`. Save JSON containing `chain`, `height`, `address`,
`txid`, `vout`, and integer `valueSats`; then run:

```sh
XBT_FULCRUM_HOST=<private-host> XBT_FULCRUM_TCP_PORT=<private-port> \
  XBT_FULCRUM_FIXTURE=/tmp/public-output.json \
  npx jest --runInBand tests/integration/xbt-fulcrum-live.test.ts
```

Both tests skip without explicit endpoint configuration. The broader read-path
test also requires the fixture path. Endpoints and credentials are not committed.

## Bitcoin digest rejection — passed 2026-09-28

For both inputs of the Knots-accepted transaction, the recorded ECDSA signatures
verify under Unified Sighash and fail under bitcoinjs-lib's independent Bitcoin
[BIP143](https://github.com/bitcoin/bips/blob/master/bip-0143.mediawiki) digest.
The negative check covers both the unchanged `0x21` signature type and an attacker
stripping the Unified bit to `0x01`.

This is a cryptographic regression check over the same transaction, scripts,
amounts, public keys, and signatures. It does not replace rejection by an
independent Bitcoin node, which remains a release gate. The three signing suites
passed locally with 14 tests, including this new control.

## Native CI checkpoint — commit 65d710ce6

GitHub run 31 passed lint and 65 unit suites (601 tests passed, 1 skipped).
Android compiled and passed all 3 selected UI suites (12 passed, 5 explicitly
deferred tests skipped), including manual-price save/restart/clear. The iOS
simulator build passed; its UI run was still active when this checkpoint was
recorded. This is not a signed device build or a TestFlight upload.

## Independent Bitcoin Core replay rejection — passed 2026-09-28

Bitcoin Core **29.0** independently rejected transactions signed by the actual
XBT wallet on an isolated regtest chain. A normal Bitcoin signature over the
**same non-witness transaction** was accepted into its mempool and confirmed
in a block. All three variants have transaction ID
`2829c3303527361f72b2349d54599bf28d8714b61275a7c935e9a7c18d89e631`.

| Variant | Core result |
| --- | --- |
| XBT Unified signatures, type 0x21 | Rejected by mandatory script verification |
| Both Unified flags stripped to 0x01 | Rejected by mandatory script verification |
| Bitcoin BIP143 signatures, type 0x01 | Accepted and confirmed once |

The Core 29.0 Linux archive SHA256 was
`a681e4f6ce524c338a105f214613605bac6c33d58c31dc5135bbc02bc458bb6c`,
matching both the official bitcoincore.org checksum file and achow101's
29.0 Guix build attestation. The temporary native process used a fresh data
directory, explicit regtest configuration, disabled P2P networking/listening,
loopback-only RPC, and zero peer connections. It was stopped and its temporary
chain data removed after the check. No production wallet or network was used.

The public funding transaction, signed variants, and node receipts are in
`tests/fixtures/xbt-bitcoin-regtest-rejection.json`. Signing code was unchanged
from `c12e63271`. The opt-in bridge
`tests/integration/xbt-bitcoin-replay.test.ts` signs only the published BIP84
mnemonic and skips by default. Its successful run alone is not a node receipt.

To reproduce: start an isolated Core 29.0 regtest node, generate mature faucet
funds, fund the two public regtest source addresses in the Knots fixture with
60,000 and 40,000 sats as ordinary outputs, and confirm that funding. Save
`{chain:"regtest", implementation:"Bitcoin Core", fundingHex, confirmations}`
as JSON. Run the bridge with explicit absolute `XBT_BITCOIN_FIXTURE` and
`XBT_BITCOIN_RESULT` paths. Call Core's `testmempoolaccept` separately on
`unifiedHex`, `strippedUnifiedHex`, and `bitcoinControlHex`. Require the
first two to fail script verification and the control to pass; then submit
and mine **only the control on isolated regtest**. Stop the temporary node.

This closes the independent Bitcoin-node rejection check for the tested
two-input P2WPKH flow. It does not prove the complete phone/Fulcrum send flow,
physical iPhone behavior, other script types, or TestFlight readiness.
