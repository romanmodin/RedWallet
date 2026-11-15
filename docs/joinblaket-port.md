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
- Python-compatible message framing and strict bounded parsing, including decoded Unicode validation.
  Gitar contributed this module; its tests also run with RedWallet's normal repository setup.
- Ephemeral nick identity and strict low-S DER message authentication; exact handshake/transcript vectors.
  Gitar contributed the initial port. Independent hardening fixes cover Hermes Buffer slices,
  structural duplicate-key validation, bounded UTF-8, key serialization, and network/version binding.
- NaCl crypto_box encryption and PoDLE commitments/revelations, initially ported with Gitar.
  All 16 libsodium known-answer fixtures are copied exactly from rc6. Independent regression fixes cover
  large encrypted messages, secret serialization, input mutation while awaiting entropy, Hermes slices,
  nonce input validation and verification-index validation. Session keys live in a private WeakMap and
  owned buffers are wiped; JavaScript cannot guarantee erasure of VM/library copies. Production encryption
  always obtains a fresh CSPRNG nonce. Frames impose a 48,000-byte plaintext bound.
- Authenticated offer parsing, fidelity-bond certificate/nick signatures, CLTV P2WSH derivation,
  certificate expiry and economic bond valuation. Certificates do not authenticate their outpoint or
  locktime by themselves: those claims must match independently proven chain output data.
- Bonded-only maker selection: cheapest per maker and per bond outpoint, exact bigint-weighted
  CSPRNG sampling without replacement, fee policy and explicit minimum-maker enforcement.
  Expiry is checked per certificate, outside the shared outpoint lookup cache.
- Individual XBT block-header PoW and bounded merkle inclusion checks, including the 164-byte
  BLAKE2b header format, tested against public block/header hashes obtained read-only from Knots.
  Invalid/negative/overflow targets and leftover merkle-position bits fail closed.
- Electrum lookup recomputes txids and output values, checks script/unspent responses and merkle proofs,
  and requires an independently established chain anchor. It rechecks the anchored tip after lookup.
  This adapter has no live transport or anchor provider yet. Inclusion is proven; unspent status still
  relies on the selected Electrum server, and this is not a full chain-consensus validator.
- CSPRNG-shuffled transaction construction with exact maker/taker accounting, dust included in the
  total cost, fee-ceiling enforcement, ownership metadata and fully verified witness assembly.
  With the shuffle held fixed for testing, the unsigned bytes, signed bytes and txid exactly
  reproduce the pinned upstream transaction vector. No private-key signing entry point is connected.
- Durable round lifecycle: exact review commitment, explicit approval, all-maker signature checks,
  persistence before permission to sign, unsigned restart cancellation, and retained reservations
  for signed/uncertain rounds. Only authenticated chain confirmation may release signed inputs.
- Wallet storage integration shares a write lock with Kilojoin and propagates secure-storage failures.
  Ordinary XBT sends and Kilojoin reject JoinBlaket-reserved coins, including after serialization.
  Finished attempts compact into identity/change-script tombstones; full journals do not accumulate with
  cancelled attempts. The archive has an explicit 100,000-entry bound and never silently forgets scripts.
  Disclosed JoinBlaket change scripts are skipped by ordinary change allocation and rejected at send entry.
  One active CoinJoin protocol per wallet is currently enforced to prevent competing change allocation.
  This does not yet provide an application controller or automatic startup recovery.
- Local recipient/coin preflight: one hot XBT P2WPKH payment, one available proof coin with
  at least five confirmations and at least 20% of the payment. This does not prove chain state.
- Serialized commitment consumption with durable-save-before-reveal, backup union, strict
  corruption rejection and the Android-compatible used/external JSON shape.
  Storage integration must use one instance per wallet plus appropriate cross-process locking.
- The existing locked @noble/curves 2.0.1 is now a direct dependency for audited X25519. No new
  version or dependency resolution was introduced.

## Required before exposure in Send

This is not a working payment feature yet. No live button, network requests or signer is connected. Existing wallet spending now honors the new
journal field, but no UI starts a JoinBlaket round.
Still required: Tor-only authenticated directory and encrypted session transport; a validated chain-anchor
provider and live proof-checked Electrum wiring; application integration of offer selection and PoDLE;
application wiring for transaction construction and all-maker 0x21 signature
verification before any taker signature; automatic startup recovery; explicit plan/fee-ceiling confirmation; encrypted backup integration;
foreground/background lifecycle, cancellation and signed-but-unconfirmed handling; market panel,
30-second refresh, progress/result/txid UI; native and disposable-chain end-to-end validation.

Market watcher estimates are informational. They are not verified makers, an agreed price,
a spend authorization or proof of privacy. No direct-network fallback is permitted for
directory or round traffic. Do not remove coins from reservations merely because a signed
round times out: a previously shared signature may still be broadcast.

The separate MAX, hardware-signing, Kilowallet release and web-wallet work is preserved.

## Deliberate port differences and unresolved dependencies

- Corrupt commitment or journal storage fails closed rather than becoming an empty history.
- A signed-but-not-confirmed payment retains its inputs, including on timeout, cancellation or restart.
- The current transaction builder accepts P2WPKH outputs only; upstream permits additional maker output
  types. Broader script support needs accurate fee/dust policy and tests before interoperability is claimed.
- Proof-coin eligibility rounds the 20% minimum upward to satisfy "at least 20%" for fractional satoshis.
- Direct read-only retrieval of the public market feed from Zorin returned HTTP 403 on 2026-11-15.
  No live market data, authenticated directory session, SPV maker/bond lookup, or live payment is verified.
- RedWallet's existing chain freshness cross-check explicitly is not SPV. It must not be presented as the
  rc6 maker/bond SPV proof. The new header/merkle adapter must receive a validated independent chain
  anchor and live transport before exposure; it may not accept the queried server as its own anchor.
