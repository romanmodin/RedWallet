# XBT Taproot beta source

This change adds a separate XBT Taproot (BIP86) wallet alongside the existing Native SegWit (BIP84) wallet. Select Taproot when creating or recovering a wallet. Existing BIP84 wallets retain their type, keys, addresses and signing rules. Recovering a phrase requires selecting its original format and BIP39 passphrase.

Supported: BIP86 receiving and change addresses, hot-wallet key-path spending, BIP39/passphrase recovery, persistence and history through the configured XBT Electrum server. Taproot cold-wallet signing, script paths, annexes, multisig, RBF/CPFP and silent payments remain outside this change. Native SegWit external signing remains available.

The signer uses Schnorr with explicit `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`), the `UnifiedSighash` tag, script type 2 and an absent-annex byte. Standard Bitcoin BIP341 and `DEFAULT | UNIFIED` signatures are not substituted. Every input amount/script and every output is committed. Raw parent verification, wallet-owned change and the 6480-confirmation coinbase policy also apply to Taproot.

The fee calculation prices the actual 65-byte witness and 34-byte change script, including transaction CompactSize lengths. Fixed recipient amounts are preserved; residual change below 330 sats is added to the fee.

## Reference checks

The public BIP86 phrase from the Bitcoin BIP86 specification is the only seed in the test fixture. On October 4, 2026, a separate Knots v29.4.1.knots20260508rc4 regtest instance with networking disabled and zero peers accepted a two-input production-wallet spend after Blake2b activation at height 150 and mined it at height 152. The transaction paid 212 sats for 212 vbytes. A changed output and removal of the Unified flag both failed Schnorr script verification. The instance was stopped after the test; no production wallet, funds or node settings were used.

`tests/fixtures/xbt-taproot-knots-regtest-acceptance.json` records the actual funding, signatures and node responses. Unit checks replay the production transaction exactly and compare against Bitcoin's independent BIP341 digest. The manual integration bridge can regenerate a public address plan with `XBT_KNOTS_PREPARE=1 XBT_KNOTS_TAPROOT=1` or sign isolated funding with `XBT_KNOTS_FIXTURE`; neither mode contacts a node or broadcasts by itself.

References: [Knots Unified Sighash](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/doc/unified-sighash.md), [BIP86](https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki).

## Release status

Taproot is implemented in this branch. Full unit/lint and fresh iOS/Android native checks are required before a tester package is released. Physical iPhone recovery/restart and a funded phone/Fulcrum spend remain to be checked. Existing TestFlight build 1791019257 does not contain this feature.
