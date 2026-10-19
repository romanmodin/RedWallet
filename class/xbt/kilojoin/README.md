# Kilojoin experimental integration

Status: participant implementation and native adapters under test. The app route remains
an **offline sample preview**, not a live mixing client. LIVE_JOIN_ENABLED is false.

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
- Session encryption using XChaCha20-Poly1305 with a device-only native Keychain key.
- Durable wallet reservations, strict persistence error propagation/readback, and
  prevention of reserved-input spends through XBT send/RBF builders.
- Restart recovery aborts unsigned rounds and retains signed/uncertain reservations.
  It deliberately does not automatically resume signing after restart.
- Native app controls and orchestration for pool discovery, wallet/coin selection,
  review/approval, broadcast and independent confirmation; disabled by the release gate.
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
types and rejected corrupted signatures. These do not constitute native device review.

Remaining release gates:
1. Device qualification of the implemented live UI/orchestrator: pool discovery,
   wallet/coin selection, exact review, explicit signing/broadcast, confirmation and
   conservative restart recovery. The release gate still shows only the offline preview.
2. Device review of mixed/change labels: confirmed change is frozen; conservatively
   recovered outputs are all frozen until the user reviews and unfreezes them.
3. Combine the passing Kotlin-peer and disposable-node harnesses with real WebSocket
   transport and backend fault injection, including disconnects, restart and late signatures.
4. Review network privacy: separate output identity/connection does not hide IPs from
   the relay or address queries from the configured backend. Do not promise anonymity.
5. Native iOS/Android/device validation and bounded mobile RSA performance review.
   JS BigInt blind-RSA operations are not claimed to be constant-time.

Latest local checks: 17 suites / 140 tests passed; full TypeScript check passed.
No mainnet transactions or relay connections are performed by unit tests.
Do not enable live mixing merely by flipping the feature constant.
