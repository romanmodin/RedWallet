# Authenticated BIP84 replacement qualification

## Implemented
- [x] Authenticate original transaction signatures and raw parents before reporting fees or constructing a replacement.
- [x] Preserve recipient scripts and amounts, input order, sequences, version and locktime; fund the increment only from change above 294 sats.
- [x] Enforce original fee plus incremental relay fee and increased fee rate.
- [x] Dedicated hot BIP84 RBF adapter; server metadata may veto but never select outputs or fee amounts.
- [x] Recheck local state after asynchronous confirmation checks.
- [x] Separate capability from legacy cancel/CPFP; legacy BIP84 actions remain disabled.
- [x] Decoded output/fee review, exact-byte broadcast binding, biometrics and high-fee approval.
- [x] Reject malformed fee text instead of silently truncating it.
- [x] Fresh isolated Knots accepted and mined replacement; original removed from mempool; insufficient increment refused.

## Native self-test coverage (execution pending)
The in-app self-test now runs `runBip84ReplacementSelfTest` using an offline public fixture and requires its success marker in Detox on both platforms.
It checks signed/unsigned construction, recipient/input preservation, change floor, Unified signatures, signer change metadata, fee increments and rejection of forged parents, altered recipients, bad signatures and already-confirmed originals.
The self-test no longer accepts a prior run's temporary lock file as a pass.
This exercises the mobile cryptography runtime; it does not replace a funded end-to-end replacement/review/broadcast test.

## Release gate
- [ ] Native Android and iOS focused replacement/review tests on the enabling source.
- [ ] Exact-source software and native release gates successful.
- [ ] Enable hot BIP84 authenticated RBF only after those prerequisites.
- [ ] External-signer BIP84 route separately qualified; the staged PSBT builder is not enabled by this change.

Production `allowAuthenticatedRBF()` remains false. Unit and node tests override it only on their public fixture instance.
This receipt is software/node evidence, not proof of native UI, physical phone or cold-device interoperability.

## Reproduce isolated node acceptance
Use the integrity-pinned Linux Knots archive recorded in `bip84-rbf-knots-20261018.json`; extract its bitcoind and bitcoin-cli into a disposable directory.
Then run:

```sh
XBT_BIP84_NODE=/absolute/test-bin/bitcoind XBT_BIP84_CLI=/absolute/test-bin/bitcoin-cli XBT_BIP84_RECEIPT=/tmp/bip84-rbf-receipt.json npx jest --runInBand tests/integration/xbt-bip84-replacement-live.test.ts
```

The test creates and deletes its own data directory, binds RPC to loopback, disables network activity and peer discovery, uses only a public fixture mnemonic, and stops its node in cleanup. It never connects to an existing wallet/node.
