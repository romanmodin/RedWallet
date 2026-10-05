# Independent XBT chain verification — next release design

Status: design only. No header-chain/SPV implementation is claimed by this lifecycle branch or PR40.

## Existing trust boundary

RedWallet authenticates configured TLS servers, checks the pinned XBT checkpoint, and validates transaction bytes/signing data. It currently trusts Fulcrum for reported confirmations, history completeness and unspent status. A source-tree check or successful regtest spend does not remove that trust.

## Proposed implementation order

1. Audit the exact deployed Knots consensus rules before coding a verifier. Specify pre/post-activation header serialization, the extended 164-byte header, BLAKE2b proof-of-work, target calculation, difficulty transitions and cumulative work. Fixed checkpoint matching is an anchor, not a complete chain proof.
2. Add a bounded, resumable header store. Verify linkage, proof-of-work and network-specific difficulty rules. Choose valid cumulative work; handle reorganization, stale peers, corrupt local state and restarts. Keep BTC and XBT rule sets and state isolated.
3. Request transaction Merkle branches and validate raw transaction identity, index and inclusion against a locally verified header. Derive confirmations from that chain. Mark missing/invalid proofs as unverified rather than confirmed. Do not alter the signing hash or broadcast payload.
4. Keep explicit uncertainty for unspent status and history completeness. A Merkle inclusion proof does not prove that an output remains unspent. Multiple independently operated servers can reveal disagreement but do not constitute a consensus proof of non-spending. Document the residual trust or offer a separately verified full-node backend.
5. Add adversarial fixtures: invalid links/targets/work, mixed BTC/XBT headers, altered extended fields, activation boundaries, forged Merkle branches/indexes, wrong txids, duplicate responses, withheld history, reorganizations and interrupted synchronization.
6. Integrate on a separate branch and qualify source, resource limits and native UI before any release claim. Independent expert review is required before presenting this as an independently verified wallet.

## Acceptance evidence

Use consensus-generated valid/invalid vectors and an independent reference implementation where available. Verify bounded CPU/memory/disk usage and safe restart/reorg behavior on Android and iOS. Separate inclusion verification, server disagreement and full UTXO validation in both tests and product language.
