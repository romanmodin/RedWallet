# XBT Taproot beta source

This change adds a separate XBT Taproot (BIP86) wallet alongside the existing Native SegWit (BIP84) wallet. Select Taproot when creating or recovering a wallet. Existing BIP84 wallets retain their type, keys, addresses and signing rules. Recovering a phrase requires selecting its original format and BIP39 passphrase.

Supported: BIP86 receiving and change addresses, hot-wallet key-path spending, BIP39/passphrase recovery, persistence and history through the configured XBT Electrum server. The follow-up source adds BIP86 watch-only import and Unified-capable external PSBT signing, RBF and CPFP. Script paths, annexes, multisig, cancellation and silent payments remain unsupported. Ordinary BTC signing firmware is incompatible with XBT Unified signatures.

The signer uses Schnorr with explicit `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`), the `UnifiedSighash` tag, script type 2 and an absent-annex byte. Standard Bitcoin BIP341 and `DEFAULT | UNIFIED` signatures are not substituted. Every input amount/script and every output is committed. Raw parent verification, wallet-owned change and the 6480-confirmation coinbase policy also apply to Taproot.

The fee calculation prices the actual 65-byte witness and 34-byte change script, including transaction CompactSize lengths. Fixed recipient amounts are preserved; residual change below 330 sats is added to the fee.

## Reference checks

The public BIP86 phrase from the Bitcoin BIP86 specification is the only seed in the test fixture. On October 4, 2026, a separate Knots v29.4.1.knots20260508rc4 regtest instance with networking disabled and zero peers accepted a two-input production-wallet spend after Blake2b activation at height 150 and mined it at height 152. The transaction paid 212 sats for 212 vbytes. A changed output and removal of the Unified flag both failed Schnorr script verification. The instance was stopped after the test; no production wallet, funds or node settings were used.

`tests/fixtures/xbt-taproot-knots-regtest-acceptance.json` records the actual funding, signatures and node responses. Unit checks replay the production transaction exactly and compare against Bitcoin's independent BIP341 digest. The manual integration bridge can regenerate a public address plan with `XBT_KNOTS_PREPARE=1 XBT_KNOTS_TAPROOT=1` or sign isolated funding with `XBT_KNOTS_FIXTURE`; neither mode contacts a node or broadcasts by itself.

References: [Knots Unified Sighash](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/doc/unified-sighash.md), [BIP86](https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki).

## Cold signing and fee bumping follow-up

Import a BIP86 account descriptor or a public account key with an explicit BIP86 origin. An ambiguous bare xpub is rejected in the XBT import flow. External signing stays disabled until explicitly enabled for a compatible XBT device. Unsigned PSBTs include authenticated raw parents, witness amounts/scripts, internal keys, derivation paths, fingerprints and owned-output metadata. Returned finalized or unfinalized PSBTs must match the current reviewed request; every 65-byte Unified Schnorr signature is checked locally. A new request, account change, disabling signing or restarting invalidates broadcast authorization. No seed is stored in the watch-only wallet.

RBF requires an authenticated unconfirmed transaction with replaceable sequences and wallet-controlled inputs. It keeps the original inputs, version, locktime, sequences and every recipient output, including payments to the wallet's receive branch. Only change funds the increase, retaining at least 330 sats per change output. Send-all transactions without enough change cannot be replaced this way. The requested fee must cover at least the original fee plus 1 sat/vB of incremental relay fee; node policy and fees of existing descendants may require a higher amount. The app does not cancel or silently reduce recipient payments.

CPFP spends unfrozen, unspent wallet outputs of one unconfirmed parent into a wallet change address. It prices the parent plus child together and currently requires the parent's inputs to be confirmed. Multiple unconfirmed ancestors, foreign outputs, dust and insufficient balance are rejected. Hot fee bumps display the actual transaction fee and require a second confirmation for high fees; external fee bumps use the normal reviewed PSBT flow.

Independent isolated Knots checks on October 4 accepted a two-input cold-signed original (212 sats / 212 vbytes), a replacement (636 sats / 212 vbytes) and a cold-signed CPFP child (3662 sats / 169 vbytes). The package exceeds 10 sat/vB. After broadcasting that child on regtest, the lower replacement correctly failed the descendant-fee rule. A 5300-sat replacement then evicted both original and child and was mined at height 154, preserving the 90,000-sat recipient output. A changed output failed Schnorr verification. Networking remained disabled with zero peers; no production funds were used. The stopped disposable node's responses and public vectors are in `tests/fixtures/xbt-taproot-cold-fees-knots.json`. `tests/integration/xbt-knots-taproot-fees.test.ts` only signs supplied public regtest fixtures; it does not call RPC or broadcast.

A specific physical cold signer's interoperability and funded phone/Fulcrum testing remain unverified. The follow-up is not in TestFlight build 1791098754 or Android beta 1791085960 until a new package is verified and distributed.

## Release status

Taproot source 755e6971 passed full unit/lint and fresh iOS/Android native checks, including creation/restart and BIP86 recovery/address persistence. Signed iPhone build 8.0.1 (1791098754) was verified, uploaded and finished Apple processing on October 4, 2026. Assignment to the existing tester groups and external beta review are verified separately by the protected manual beta workflow. Physical iPhone recovery/restart and a funded phone/Fulcrum spend remain to be checked. Earlier iPhone build 1791019257 and Android beta 1791085960 do not contain Taproot.
