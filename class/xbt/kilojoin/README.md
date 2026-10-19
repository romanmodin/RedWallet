# Kilojoin experimental integration

Status: opt-in experimental participation in the main app under Settings > Tools.
The user authorized inclusion as a visibly experimental feature on October 18, 2026.
An amber Testing label, explicit entry acknowledgment and per-transaction signing
confirmation distinguish participation from the separately available offline sample.
LIVE_JOIN_ENABLED is true; client joins also require experimentalAcknowledged=true.
This is experimental distribution, not a claim of complete device qualification.

Pinned upstream: Kilombino/kilowallet v1.1.6, commit
`06e1ac9a346bd810db1749ca0b1048d0da980c35`.
Original author: Kilombino. Adapted files retain Apache-2.0 terms; see
UPSTREAM-LICENSE and UPSTREAM-NOTICE. RedWallet uses existing Noble and bitcoinjs
cryptographic implementations, unlike upstream's standalone primitives.

Implemented:
- NIP-01 validation/signing, NIP-44 v2 encryption and bounded authenticated routing.
- Creator/member authority separation, event replay/freshness and roster sequence checks.
- Ownership proofs, immutable own-seat commitments, duplicate/unselected input rejection.
- RFC9474 SHA384-PSS randomized blind output registration and verification.
- Participant welcome, roster, voting, closing, blinded output hand-in, review, explicit
  approval, verified signature collection and canonical transaction assembly.
- P2WPKH/P2TR XBT 0x21 signatures, exact fee/change review and backend revalidation.
- Bounded relay queue, publication acknowledgments/timeouts and separate output socket.
  Subscription generations reject late/queued frames from superseded subscriptions.
- Session encryption using XChaCha20-Poly1305 with a device-only native Keychain key.
- Durable wallet reservations, strict persistence error propagation/readback, and
  prevention of reserved-input spends through XBT send/RBF builders.
- Restart recovery aborts unsigned rounds and retains signed/uncertain reservations.
  It deliberately does not automatically resume signing after restart.
- Native app controls and orchestration for pool discovery, wallet/coin selection,
  review/approval, broadcast and independent confirmation after explicit opt-in.
- Confirmed output labels and frozen change; restart confirmation freezes recovered
  outputs instead of guessing their privacy role.
- Native backend adapter verifies raw parents, matching unspent/history heights and
  coinbase maturity. This experimental adapter requires confirmed coins.
- Wallet signer checks persisted approval, exact transaction and reservation ownership.

Validation includes upstream transaction/NIP44/ownership/RFC9474 vectors; simulated
fully encrypted P2WPKH and P2TR rounds; native adapter mocks; wallet-key test signing;
failed storage, concurrency, restart, tampering, fee and ordinary send/RBF regressions.
The pinned Kotlin CoinjoinTx/crypto code additionally verified RedWallet raw transactions
and signatures for P2WPKH/P2TR; RedWallet verified Kotlin-produced signatures in return.
See tests/native/kilojoin for the reproducible standalone harness and source hashes.
The original pinned Kotlin PoolSession also completed full encrypted v3 rounds with
RedWallet over a local test relay for both script types, with identical signed bytes.
A separate disposable, peer-network-disabled XBT node accepted/mined both transaction
types and rejected corrupted signatures. Real loopback WebSocket tests additionally cover acknowledgments, disconnection,
separate output connections, and obsolete subscription frames. These do not
constitute native device review.

Remaining qualification work (not represented as completed):
1. Device qualification of the implemented live UI/orchestrator: pool discovery,
   wallet/coin selection, exact review, explicit signing/broadcast, confirmation and
   conservative restart recovery. The sample preview remains available without accessing a wallet.
2. Device review of mixed/change labels: confirmed change is frozen; conservatively
   recovered outputs are all frozen until the user reviews and unfreezes them.
3. Combine the passing Kotlin-peer and disposable-node harnesses with real WebSocket
   transport and backend fault injection, including disconnects, restart and late signatures.
4. Review network privacy: separate output identity/connection does not hide IPs from
   the relay or address queries from the configured backend. Do not promise anonymity.
5. Native iOS/Android/device validation and bounded mobile RSA performance review.
   JS BigInt blind-RSA operations are not claimed to be constant-time.

Previous isolated-branch checks: 18 suites / 144 tests passed. Combined-source checks
are recorded in the PR and exact-source CI, including the new SegWit RBF reservation regression.
No mainnet transactions or relay connections are performed by unit tests.
Main iOS signing still requires the existing exact-source unit/lint, general iOS and
funded BIP84 gates. The user approved experimental availability, not removal of
transaction validation, durable reservations or signing confirmations.

## Protocol v3 cross-check, 2026-10-19

Compared with Kilombino/kilojoin `docs/PROTOCOL.md` section 11 at upstream commit
`7a5037fc9ba517a92c66a8f8b89765f407a92b2c` (Kilojoin 0.7.0). This integration
already requires version 3 announcements; it is not limited to v1/v2 pools.
The implementation includes the separate creator identity and RSA public key,
creator-authenticated pool control messages, seat HMACs, per-seat ownership and
chain checks, RFC9474 blind output registration, a fresh output key and connection,
and the inherited P2WPKH/P2TR transaction rules. The interoperability harness above
uses Kilowallet 1.1.6, which includes this v3 protocol.

The pool-list defect was an unsupported multi-letter Nostr filter (`#network`)
rejected by the deployed relay. Discovery now requests indexed `#t`/kind filters
and validates the signed network and v3 terms locally. The iPhone simulator smoke
on source `af7710de8b2c527060b57f4224d6777381762e8b` visibly returned two compatible
open pools (Actions run `39248046525`). This proves discovery, not real-fund round
completion. The full release gate for that run failed in the separate unlock test;
experimental limitations and all signing/release gates above remain in force.
