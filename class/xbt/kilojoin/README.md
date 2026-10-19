# Kilojoin experimental integration

Status: offline compatibility foundation and app preview. **Not a working live mixing client.**

Pinned upstream: Kilombino/kilowallet v1.1.6, commit
`06e1ac9a346bd810db1749ca0b1048d0da980c35`.
Original author: Kilombino. Adapted files retain Apache-2.0 terms; see
UPSTREAM-LICENSE and UPSTREAM-NOTICE. RedWallet adaptations use its existing
Noble and bitcoinjs cryptographic implementations, unlike upstream's standalone primitives.

Implemented:
- NIP-01 event validation/signing and NIP-44 v2 encryption, authenticated decoding,
  bounded parsing and explicit entropy inputs.
- Kilojoin v3 pool validation, ownership proofs and protocol commitments.
- Participant message boundary: creator/member authority separation, authenticated
  decryption, recipient checks, bounded replay cache and stale-message rejection.
- Roster validation: ownership proofs, sequence checks, exact own-seat commitment,
  duplicate input/identity rejection and fresh independently supplied chain observations.
  These modules are not yet connected to a live session or backend adapter.
- Client-side RFC9474 randomized SHA384 RSA blind signatures; no RSA key generation
  or coordinator private-key implementation.
- Canonical P2WPKH/P2TR transaction assembly, XBT 0x21 digests, signature verification,
  independently supplied prevout checks and per-user fee/change review.
- Offline lifecycle with explicit review approval and durable-write-before-signing
  boundary. Signed cancellation retains coin reservations.
- Settings > Tools > CoinJoin — Experimental: sample-only interactive preview.
  It has no wallet key, network, relay, signing or broadcasting dependencies.

Validation: upstream P2WPKH raw transaction/txid/signatures, NIP44 event and ciphertext,
fee/ownership commitments, RFC9474 blinding/finalization vector, malformed/changed
inputs and fees, journal failures, cancellation behavior and preview UI.
Current targeted validation: 6 suites / 54 tests pass; full TypeScript check passes.
These vectors do not prove a complete v3 round works across wallets.

Remaining release gates:
1. Authenticated v3 participant transport/state machine (welcome, roster, votes,
   blinded output exchange, signature collection, duplicate/replay protection).
2. Chain-backed roster validation and transaction revalidation immediately before
   signing, including rejection of additional unselected coins owned by our wallet.
3. Wallet-wide persistent coin reservations, encrypted session secrets, restart
   recovery, mixed/change labeling and coin-selection isolation. The offline journal
   interface is not yet wired into storage or the ordinary send/CPFP paths.
4. Network privacy design: separate output connection/identity does not itself hide
   IP addresses from a relay. Do not promise unlinkability or anonymity.
5. Native entropy integration, bounded crypto scheduling and mobile performance review.
   JS BigInt blind-RSA operations are not claimed to be constant-time.
6. Regtest rounds against the actual Kotlin peer, including failures and P2TR vectors;
   native iOS/Android build and device review; small-value private beta only afterward.

LIVE_JOIN_ENABLED remains false. No mainnet transactions or relay connections are
performed by tests. Do not enable this merely by flipping the constant.
