# Isolated XBT signing core

This directory ports the native RedWallet P2WPKH Unified Sighash core. It is not
connected to the web wallet UI, key storage, canister or bridge. The deployed
web product remains watch-only until the spending workflow is implemented and
verified end to end.

## Provenance

- Native repository: `romanmodin/RedWallet`
- Read-only source worktree: `/home/roman_modin/RedWallet-ios-import-fix`
- Source commit: `eebada6df427874e4be03bfd89041d04ff364ae5`
  (`fix: replace blue app icons with red wallet branding`)
- Core files: `class/xbt/unified-sighash.ts` and `class/xbt/unified-psbt.ts`
- Native fixtures: `tests/unit/fixtures/unified-sighash-segwit-v0.json` and
  `tests/fixtures/xbt-knots-regtest-acceptance.json`
- Source was inspected and copied on 2026-09-29. The native worktree was not modified.

Native source SHA256 values, before the browser imports/provenance comments:

| File | SHA256 |
| --- | --- |
| `unified-sighash.ts` | `19ed1a5358ea4dca9a7372335295a79fead44adc13350c33cbc9647ac6d97b41` |
| `unified-psbt.ts` | `b418fc027a69401dbf8df42abf116034f0b7819e5abe561b7ca9da57f16eff35` |

The two core modules preserve the native algorithm. Their only browser adaptation
is an explicit `Buffer` import from the browser-compatible `buffer` package.
Relevant direct dependencies match the native exact versions: `bitcoinjs-lib
7.0.1`, `buffer 6.0.3`, `@noble/secp256k1 3.1.0`, and `@noble/hashes 1.8.0`.
Noble is used by test helpers with `prehash: false` and low-S verification;
production signing accepts a caller-provided signing callback.

## Supported operation and caller obligations

Only native P2WPKH inputs with `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`) are
supported. The tagged digest is `UnifiedSighash`, commits to all spent output
amounts/scripts, and preserves the native five-byte locktime encoding. Bitcoin's
standard `Psbt.signInput` and finalizer are deliberately bypassed.

Before calling the signer, a wallet must independently validate all input parent
transactions, outpoints, amounts, scripts, ownership and coinbase maturity. It must
validate destination/change outputs and fees against the user's reviewed intent.
The core verifies structural constraints and supplied signatures; it does not
discover UTXOs, verify a chain, select coins, store keys, or broadcast transactions.

## Tests

Run `pnpm --dir src/frontend test src/lib/xbt` from the project root.

- All eight upstream Knots digest vectors are checked separately.
- PSBT signing, verification, finalization and round-trip behavior use public
  synthetic scalar test keys. Wrong-key, tampered-signature and changed-input-amount
  checks preserve the native negative tests.
- The recorded two-input transaction accepted/mined by Knots on 2026-09-28 is
  reconstructed byte for byte. This test uses its existing public signatures,
  not a private key or recovery phrase. Output mutation and stripped Unified-bit
  controls are rejected. This is offline fixture parity, not a new live-node test.
- A Vite browser bundle executes all vectors, accepted-transaction parity and
  synthetic signing in an isolated JavaScript context without Node `Buffer`,
  `process`, or `require` globals. This checks browser bundling/runtime compatibility;
  it is not physical iPhone or complete browser UI validation.

The `*-harness.ts`, `test-helpers.ts`, `accepted-fixture.ts`, JSON fixtures and test
files are test-only. No application page or service imports them or the core.

## Gates before enabling web spending

Implement and verify browser-only seed generation, encrypted persistence,
backup/recovery, lock/unlock and HD discovery. Add constrained UTXO and raw-parent
reads through the verified XBT bridge; independently verify every parent/output
before signing. Implement integer-satoshi coin selection and a user-reviewed
recipient/change/fee flow. Add constrained broadcast with txid verification and
duplicate-submission handling. Run isolated activated-XBT acceptance and Bitcoin
replay-negative tests on the web implementation, then verify actual deployed
canister/browser send behavior. Preserve honest watch-only UI until those gates pass.
