# Fresh web signer node verification — 2026-09-29

The **web** `planSpend` / `signReviewedPlan` implementation was tested against
newly funded, isolated regtest chains. This is new node evidence, not only parity
with the native wallet's previous accepted fixture. Only the published BIP84
mnemonic was used. No real funds, production wallet keys, or production node
configuration were involved.

## XBT Knots

Existing installed image `sha256:b54aac30c0a9568c0d19813c22560721ecf7d260c54ad082d35506a19b979e16`
was run in a separate container with Docker `--network none`, no published ports
or host mounts, a 512 MB memory cap and one CPU. Chain=regtest,
networkactive=false, connections=0; BLAKE2b active at height 150. Funding height
152; two ordinary P2WPKH outputs of 60,000 and 40,000 satoshis.

The web planner paid 90,000 satoshis, returned change, and charged 211 satoshis
for a 209-vbyte Unified 0x21 transaction. `testmempoolaccept` accepted it and it
was confirmed at regtest height 153:
`f2d07953bea3403b2c1e4581eed2fb7e446d6b08a6ea6280e3aa8493ecd3c05b`.
Changing an output and removing the Unified bit both failed script validation.

The ordinary Bitcoin-signature control was also accepted by this XBT node.
The initial harness expectation that XBT would reject that control was wrong;
that assumption was corrected, not the observed result. Replay protection here
is established by the independent Bitcoin rejection test below, not by claiming
XBT rejects every ordinary Bitcoin signature.

## Independent Bitcoin Core 29.0

Reused the previously downloaded official Core archive on Zorin, checked its
SHA256 against the saved SHA256SUMS and matched both executables to the archive.
A new temporary datadir was used with regtest, listening/discovery/seeds disabled,
networkactive=false, connections=0, and a dedicated loopback RPC port.

Fresh funding at height 102 was signed by the same web harness. Core rejected
both the Unified signature and the same signature with the Unified bit removed.
It accepted the ordinary Bitcoin-signature control with identical non-witness
transaction bytes and txid:
`e98d1836477b27b2cc20d8633b46db29cdebf999789bfc8888afaafbff7d81fc`.
No transaction was submitted to Core; checks used testmempoolaccept only.

Both temporary test nodes were stopped after collecting evidence. Test datadirs
were retained; no production service or native app worktree was changed.

## Reproduction and limits

`src/frontend/src/lib/xbt/regtest-harness.mts` accepts distinct absolute fixture
and output paths. Bundle it for Node using the existing Vite/esbuild dependency,
then run it with either saved public fixture. It performs no RPC or broadcast.
Compare the result with the corresponding signed fixture and node receipt.
The script checks supplied isolation evidence, but the controller must separately
verify the actual node's chain, network isolation and activation before any RPC.

This closes the fresh isolated node-acceptance/replay gate for the offline web
planner. It does **not** verify the eventual browser review/broadcast workflow,
live UTXO freshness, recovery UI, or actual canister integration. Live remains
watch-only. Keep those remaining gates before enabling real deposits/spending.
