# JoinBlaket integration

Upstream: Kilombino/kilowallet-ios v1.0.0-rc6,
commit 6a07be1835dc650a6274a90eb0ffeb214b5310ef, released 2026-11-14.
Source paths: core/src/commonMain/kotlin/com/kilombino/kilowallet/core/joinblaket
and core/src/jvmTest/resources/joinblaket/xbt-taker-vectors.json.
The upstream code and vectors are Apache-2.0; see third-party/joinblaket/LICENSE.
RedWallet adaptations retain the protocol rules while rejecting malformed input.

## Current implementation

- Exact decimal fee arithmetic and half-even rounding, quantized fee grid, maker fee limits,
  mining fee bounds, and sweep calculation tested against pinned upstream vectors.
- Strict read-only market parsing and bounded estimates; watcher claims never become verified offers.
- Maker 0x21 signature verification using RedWallet’s existing unified sighash; checks every maker input,
  rejects high-S/invalid DER/replayable signatures and mutated prevouts or outputs. This is not plan approval or SPV.
- Local recipient/coin preflight: one hot XBT P2WPKH payment, one available proof coin with
  at least five confirmations and at least 20% of the payment. This does not prove chain state.
- Serialized commitment consumption with durable-save-before-reveal, backup union, strict
  corruption rejection and the Android-compatible used/external JSON shape.
  Storage integration must use one instance per wallet plus appropriate cross-process locking.

## Required before exposure in Send

This is not a working payment feature yet. No live button, network requests or signer is connected.
Still required: Tor-only authenticated directory and NaCl sessions; authenticated maker offers,
fidelity bond and SPV verification; PoDLE; transaction construction and all-maker 0x21 signature
verification before any taker signature; durable input/change reservations across ordinary sends,
CoinJoin and app restarts; explicit plan/fee-ceiling confirmation; encrypted backup integration;
foreground/background lifecycle, cancellation and signed-but-unconfirmed handling; market panel,
30-second refresh, progress/result/txid UI; native and disposable-chain end-to-end validation.

Market watcher estimates are informational. They are not verified makers, an agreed price,
a spend authorization or proof of privacy. No direct-network fallback is permitted for
directory or round traffic. Do not remove coins from reservations merely because a signed
round times out: a previously shared signature may still be broadcast.

The separate MAX, hardware-signing, Kilowallet release and web-wallet work is preserved.
