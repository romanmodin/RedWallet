# Standard hardware signing: draft, release blocked

Native SegWit watch-only standard SIGHASH_ALL (0x01) preparation, full funding transactions, preserved origins, exact reviewed-transaction/signature validation and broadcast-time separation checks are implemented. Unified remains the default. No private key is imported.

`STANDARD_HARDWARE_RELEASE_ENABLED` remains false. The setting is hidden and runtime guards reject activation, proof preparation, result authorization and broadcast. Tests bypass that guard only for the candidate path. This is not a TestFlight release or a physical Keystone signing result.

## Separation evidence and trust

Unified funding alone is insufficient: different SegWit signatures can share one transaction ID. The candidate requires direct Unified P2WPKH funding with six XBT confirmations, plus a *different* confirmed SHA-256 transaction spending one of that funding transaction's inputs. Thus the funding body cannot coexist on the checked SHA-256 chain.

The app retrieves outspend evidence, raw transactions, Merkle branches and headers from Blockstream. It cross-checks the fork checkpoint, current heights, conflict block hashes and block transaction counts against mempool.space. It hashes the transaction/header locally, checks the exact conflicting outpoint, validates Merkle inclusion with anchored depth/position/count, permits only legitimate odd-level duplication, and requires six confirmations. Each selected funding transaction must qualify. Absence, missing evidence, malformed responses, disagreement and outages all block.

**Trust model:** this relies on two independently operated HTTPS explorer chain views. It is not local consensus/header-chain validation and does not protect against both sources supplying an agreed false view or a later sufficiently deep reorg. The UI confirmation and review disclose this. No SHA-256 wallet session is selected or connected. The explicitly enabled mode would send public funding-ancestor transaction IDs to Blockstream and block lookups to both providers, revealing IP/request timing. It sends no xpubs, seed, PSBT or payment destinations to these services. Requests use GET only, with deadlines, count and accepted body-size limits.

Evidence is freshly collected before request creation and again before XBT broadcast. Block hashes are re-read at the end of collection. Authorization is checked throughout requests and after asynchronous work. Review/mode changes invalidate the request. A slow hardware review does not expire a valid returned signature; pre-broadcast verification must still succeed.

## Scope and remaining qualification

- Coin selection runs once; only selected inputs undergo separation verification. Existing base-wallet UTXO integrity/maturity checks remain intact.
- Initial support is direct Unified P2WPKH funding. Descendants (including standard-send change), coinbase, mixed/Taproot funding and RBF remain unsupported and block if selected. No automatic coin splitting is performed.
- Physical Keystone 3.0.2 signing, isolated Knots acceptance/replay tests, native UI and independent review remain release requirements.
- Umbrel Docker inspection was unavailable without sudo authentication; no node settings or funds were changed.

## Validation

The focused suite covers proof integrity, independent-source disagreement, reorgs, malformed/insufficient evidence, cancellation, exact selected inputs, delayed signing, mode changes, existing XBT Unified signing and BTC hardware signing. TypeScript and changed-file ESLint are checked.

A read-only live public-chain exercise passed on November 13 Pacific (November 14 UTC), using a real confirmed SHA-256 transaction and a hypothetical conflicting funding body. This verifies live transport and proof inclusion only, **not XBT transaction validity, actual wallet separation or hardware acceptance**. Receipt: `docs/evidence/standard-hardware-public-proof-20261113.json`. Reproduction: `node scripts/diagnostics/check-separation-service.cjs` from repository root with dependencies installed. No keys/signing/broadcast calls exist in that diagnostic.
