# XBT CPFP with multiple unconfirmed ancestors

The XBT Taproot helper discovers the selected transaction's unconfirmed ancestors before constructing a child, retaining both hot and reviewed external signed-PSBT paths. XBT SegWit fee actions remain disabled by the security containment; ordinary sends and receives remain available. Bitcoin wallet behavior is unchanged. Frozen outputs are excluded from child construction.

Raw transactions are checked against their requested transaction IDs. Fees use verified raw prevouts, not server-reported amounts. Fresh verbose reads use one captured Electrum client, bypass the confirmed-transaction cache, and reject connection changes. Servers without verbose transaction support cannot use this feature.

Shared ancestors are counted once. The child pays its own target fee plus each ancestor's positive fee shortfall. Surplus fees from another ancestor are not credited because that ancestor may confirm separately. This conservative calculation can cost more than a full mempool analysis. The existing total-fee review, high-fee warning and signing authorization remain in place. No automatic broadcast or retry is added.

Safety bounds: 24 ancestors plus the child, 101,000 package virtual bytes, 128 transaction lookups, 2 MB of raw data, 400 KB per transaction, and a 20-second discovery deadline. Missing or malformed data, invalid prevouts, conflicting inputs, unsafe arithmetic, insufficient funds and dust fail closed.

Confirmation status still depends on the selected server; this is not full SPV verification or an atomic mempool snapshot. Node minimum fees, descendant limits, sigop-adjusted policy sizes and changing mempool state can still prevent acceptance. A fee quote does not guarantee confirmation.

## Validation

Unit tests cover shared ancestry, fee shortfalls, malformed/missing data, conflicts, confirmation boundaries, count/time/size bounds, rounding, fresh reads and disconnects. Taproot tests cover multi-ancestor hot and externally signed PSBT children. Existing lifecycle/signature tests exercise both formats.

The opt-in isolated Knots test creates four unconfirmed ancestors with shared ancestry for each format, verifies mempool acceptance and package fees, then mines the children. It uses public fixture keys and a new temporary regtest directory with networking disabled and zero peers.

Run with compatible XBT Knots binaries:

```sh
XBT_CPFP_NODE=/absolute/path/to/bitcoind \
XBT_CPFP_CLI=/absolute/path/to/bitcoin-cli \
XBT_CPFP_RECEIPT=/absolute/path/to/receipt.json \
npx jest --runInBand tests/integration/xbt-cpfp-ancestors.test.ts
```

The binaries must support BLAKE2b regtest activation and XBT Unified signatures. Physical cold-signer interoperability is not established by software-fixture tests.

## Security reconciliation (2026-10-18)

The earlier SegWit integration receipt is historical, not current enabled functionality. BIP84 entry points reject before network reads or signing. Unknown server confirmation status remains unverified; ancestor counts and sizes are bounded, and the Taproot review must show the actual total fee and require the existing high-fee approval. Native qualification is required on this reconciled source before merge or release.
