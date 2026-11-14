# Standard hardware signing: draft, release blocked

The implementation supports a Native SegWit watch-only PSBT round trip using standard SIGHASH_ALL (0x01), complete funding transactions, retained key origins, exact reviewed-transaction validation, signature validation, expiring in-memory authorization, and a separate broadcast path. Unified remains the default. No private key is imported.

STANDARD_HARDWARE_RELEASE_ENABLED is false. The setting is hidden and runtime guards reject mode activation, proof preparation, signing-result authorization, and broadcast. Tests bypass that guard only to exercise the candidate implementation.

## Release blocker

Direct Unified-signed funding is insufficient evidence of cross-chain separation. SegWit transaction IDs exclude the witness. The same transaction body can have valid Unified and standard signatures and the same txid. The unit test reproduces this with public test keys. A user assertion that no counterpart was signed is not a verified separation proof.

Before enabling, implement and test chain-exclusive ancestry or a confirmed conflicting spend on the SHA-256 chain. Verify chain identity, transaction bodies, inclusion/confirmations and reorg behavior under the wallet's explicit server trust model. Do not silently connect the BTC wallet subsystem while XBT is selected. Repeat verification immediately before broadcast. Unknown/unavailable proof must block.

Current funding checks validate every direct parent signature against Unified P2WPKH, exact UTXOs, raw grandparents, and six confirmations reported by XBT history. These are preliminary checks, not a complete separation proof. Descendants, coinbase, mixed/Taproot funding and RBF are unsupported. Candidate validation currently examines all supplied coins; use selected inputs for focused tests.

## Remaining verification

- Stronger separation proof and negative/reorg fixtures.
- Isolated Knots acceptance and replay tests with no user funds.
- Real Keystone 3.0.2 PSBT round trip and device review.
- iOS UI checks, independent review and TestFlight build.

No transaction was signed by user hardware or broadcast during this implementation.

## Confirmed-conflict verifier added

`separation-proof.ts` checks that a different transaction body spends a funding input and has a valid merkle inclusion branch in a separately anchored SHA-256 block with at least six confirmations. It rejects same-txid/witness-only alternatives, unrelated spends, mismatched headers, malformed branches and insufficient confirmations. Thirteen focused tests pass.

This is a pure verifier, not a live separation service. The anchor must come from an independently authenticated current BTC chain view, never from the proof bundle itself. Header-chain authentication, evidence discovery, wallet integration and fresh broadcast-time checks remain unimplemented; the release gate remains false. Synthetic headers in unit tests test inclusion mechanics only and do not establish live consensus validity.
