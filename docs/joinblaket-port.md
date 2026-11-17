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
- Strict session message codecs match pinned fill, ioauth and encrypted signature vectors. Incoming
  messages must match the expected maker, recipient and state command; the protocol does not sign the
  command itself, so a session controller must enforce ordering. Maker input authorization verifies
  control of the NaCl key through an input key, duplicate/overlapping inputs, chain-proven amounts,
  metadata, dust/change, output types and a stable chain view before returning a transaction part.
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
  corruption rejection and the Android-compatible used/external JSON shape. BlueApp now caches one
  store per active wallet and persists commitment metadata through strict saveToDisk(true), sharing
  the CoinJoin write lock. Compare-and-swap rejects stale adapters; failed writes roll back, and
  wallet removal/identity change prevents revelation. Full wallet serialization preserves history;
  a mnemonic-only backup does not. Explicit backup-import UI and controller wiring remain pending.
- The existing locked @noble/curves 2.0.1 is now a direct dependency for audited X25519. No new
  version or dependency resolution was introduced.

## Authenticated directory client

The client now pins the production Tor endpoint, network and directory identity, requires the complete
nick-authentication exchange, and blocks application send/receive until authentication succeeds. The
native factory connects this client to the iOS bridge only when explicitly invoked. Pings and peer lists
are handled separately; repeated/out-of-order authentication closes the connection. There is no public
raw-send API. Closing or cancellation does not destroy the caller-owned ephemeral identity.

Limits are explicit: 64 KiB frames (stricter than upstream receive limits), 1,024 queued frames / 8 MiB,
64 queued writes, one consumer, 20,000 cached peers / 8 MiB, and a bounded/rate-limited peer-list collector.
Late connections are closed, malformed frames are bounded, writes serialize, peer capabilities merge
without downgrading, and continuous chunks cannot extend the collection deadline. Tests exercise the
complete authenticated exchange through an injected native bridge contract, not a real native socket.
The nick verifier now accepts encrypted messages that fit the actual 64 KiB wire limit; its former
60,000-character cutoff incorrectly rejected a valid maximum-size NaCl message.

Native CI at 67aceb48 and 78f5a5e05 passed all seven transport tests, including the embedded CRLF rejection that
failed at 1883efd88. The writer now checks CR/LF bytes directly because Swift treats CRLF as one
Character. The native wallet regression job and public-node sync also passed at both commits. The
integrated app simulator build passed at 78f5a5e05 with this branch's Lightning/Tor bridge enabled; the
earlier default app build did not include that bridge. These results do not qualify full nick authentication.

## Read-only authenticated orderbook

The new collector uses the authenticated client to request peer discovery and exactly one public
`orderbook` request (without an extra leading `!`). It validates signed offers and bond certificates,
deduplicates by maker/order with the later certificate expiry, and retains the connection for the
caller. It sends no fill, commitment, wallet input, transaction or wallet signature. This is certificate
verification only; proven chain data and current bond valuation are still required before selection.

The watch has minimum/quiet/absolute time limits, one collector per client, 10,000 candidate messages,
32 MiB of candidate input and a separate 20,000-frame traffic limit. Partial results are explicitly
marked truncated. Offers are parsed incrementally; raw traffic is not retained. Cancellation closes
the connection, and continuous traffic periodically yields so cancellation can run. An integration
test exercises the real directory authentication state machine followed by the pinned signed offer.
It uses an injected stream and does not claim live Tor or real-chain verification.

## App-level read-only qualification

Settings → About → Self-test now includes an explicit JoinBlaket connection check when the native
iOS bridge is present. Visiting the screen does not connect. The check creates a fresh temporary
nick, authenticates through the actual JavaScript/native Tor adapter, requests the orderbook and
reports only public counts. It never loads a wallet or sends a fill, PoDLE proof, transaction or
wallet signature. Authentication uses the temporary nick's own signature.

A five-minute total deadline covers identity generation, authentication and market collection.
Cancellation, backgrounding and leaving the screen close the connection and destroy the identity;
late entropy completion cannot revive a cancelled attempt. Truncated discovery is rejected. Empty
markets are reported honestly. The display explicitly excludes chain/bond-output verification and
payments. This is a connection diagnostic, not a Send entry point.

The separate `joinblaket-market` CI job uses this run's real simulator app on a fresh device, requires
successful nick authentication and at least one certified live offer, and records counts without
retaining identities or raw traffic. It does not depend on the long wallet UI test job. At introduction,
the 20 new cancellation/lifecycle/summary tests passed (358 total targeted tests); live native results
for this new path are pending. The earlier native challenge-only probe passed at e7711f434, while
the separate Lightning onion-peer RPC timed out and general UI simulators had unresolved failures.

## Native Tor transport

The iOS bridge now has an explicit, dormant JoinBlaket line-transport entry point. It uses the existing
in-process Arti engine and Network.framework SOCKS5 proxy with direct failover disabled. Both native
and JavaScript sides pin the rc6 onion and port; no arbitrary target or DNS fallback is exposed. Each
connection gets a separate SOCKS isolation credential. Only one handle may be active; cancellation,
backgrounding, bridge invalidation and late-open completion close it. Native handles are retired for
this process lifetime (10,000-handle bound fails closed). iOS 17 or newer and an active foreground app
are required. This does not run a background payment service or sign anything.

Byte-limited native line buffering, CRLF writes, bounded open/write deadlines, and rejection of parallel
reads/writes protect the bridge. The adapter tests use injected native promises; they do not prove real
Tor routing. Native tests cover fragmented UTF-8, size limits, stale handles and bootstrap cancellation.
The existing iOS Tor smoke job also includes a read-only directory handshake/challenge check; that check
does not complete nick authentication or send a fill. The first live check at 1883efd88 failed after
125 seconds; its cancellation error did not identify the original failure stage. The probe now reports
bootstrap/connection/handshake stages and uses a separately cancellable deadline callback. The later probes passed at 67aceb48 (52.305 seconds) and 78f5a5e05 (22.829 seconds): the real onion accepted the XBT handshake
and sent its nick-authentication challenge through the app's Tor on an iPhone simulator. The overall
jobs were subsequently cancelled during the separate full LND Tor-sync test. The workflow now reports
the directory probe in its own job, separately from the long-running Lightning sync. This establishes a live
read-only challenge result, not full nick authentication, a verified market, or a payment.

## Initial payment confirmation

`initial-plan.ts` implements the separate approval that precedes fill/PoDLE disclosure. It selects an
eligible proof coin first, then confirmed available coins to cover the maker fees and a five-input-per-maker
mining estimate ceiling. It validates maker/bond certificates, snapshots the validated selection, and binds
wallet, attempt, directory identity, validated chain height/hash, recipient, change, selected inputs and fees into the review
identity. The caller still must supply independent chain verification and identify a fresh proof locally.

The displayed maximum includes possible unreturned dust change. A cancellation, changed context, expired
five-minute confirmation, late answer or clock rollback cannot authorize disclosure. Runtime approvals are
one-use and cannot be recreated from serialized review data. `assertPaymentMatchesPlan` ties the later
constructed transaction to the consumed initial approval, including every maker fee and the actual wallet
cost. Dropping a maker is allowed only above the approved minimum; a replacement requires a new approval.

This module does not reserve coins, consume commitments, open the UI, contact makers or sign. The controller
must still wire durable reservations and fresh-commitment consumption before fill. PaymentRound's later exact
transaction approval, all-maker signature checks and persistence-before-signing remain independently required.
The new tests cover cancellation races, immutable snapshots, substitution/fee escalation and actual built
transaction costs across maker input counts and dust boundaries. No production entry point is connected.

## Required before exposure in Send

This is not a working payment feature yet. No live button or signer is connected. Only an explicit call to the dormant native transport opens a connection. Existing wallet spending now honors the new
journal field, but no UI starts a JoinBlaket round.
Still required: native validation of the authenticated directory and the encrypted session controller; a validated chain-anchor
provider and live proof-checked Electrum wiring; application integration of offer selection and PoDLE;
application wiring for transaction construction and all-maker 0x21 signature
verification before any taker signature; automatic startup recovery; application wiring of the initial plan/fee-ceiling confirmation; encrypted backup integration;
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
