# Unwired recovery and transaction validation preparation

DiscoverySession wraps reviewed account discovery with public in-memory observations, 3500ms request-start pacing, progress callbacks, pause/retry reuse, single active run, cancellation during delay/in-flight request, and five-minute pause cache expiry. Errors/malformed history never mean unused. Completed sessions cannot be reused as fresh chain data; start a new scan. No keys, persistence, or RPC implementation. Four focused tests and frontend typecheck passed. Actual shared quotas may still yield explicit errors; this is not quota bypass.

validateSignedWebTransaction is a standalone Node structural parser, NOT an exposed route. Accepts only the reviewed signer's version2 SegWit P2WPKH format: 1–100 distinct noncoinbase outpoints, empty scriptSig, exact RBF sequence, 1–2 P2WPKH outputs within dust/monetary bounds, canonical short lengths, strict DER framing, compressed public keys, Unified0x21 signatures, zero locktime and no trailing bytes. Computes exact nonwitness SHA256d transaction ID. It does not validate signatures or previous input values: XBT node consensus is still required.

Five focused bridge parser tests passed using the fresh public regtest fixture, including independently accepted expected txid, ordinary BTC/strippedUnified rejection, duplicate outpoints, malformed/truncated/oversized encodings and an honest altered-output example requiring node rejection. No transaction submitted. No broadcast route added.

These files are implementation preparation only. Existing watch-only UX and live bridge unchanged.
