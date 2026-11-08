# Explicit blue Bitcoin wallets

This change restores Bitcoin SHA-256 on-chain transactions through a distinct
`HDsegwitBech32BTC` wallet type. Existing wallets keep their XBT types and caches.
BTC is an explicit choice during creation/import and uses the blue palette.

## Network lifecycle

- Creating, importing, and restoring the BTC wallet are offline operations.
- Selecting its card or a screen belonging to it enables that wallet's BTC
  session. Reads and broadcasts require the selected wallet ID.
- Selecting another wallet, leaving wallet-specific routes, or backgrounding the
  app disconnects BTC. Generation checks reject results from an old session.
- The initial server is `electrum.blockstream.info:50002`, using authenticated
  TLS with certificate verification. This uses the existing tracked
  `electrum-client` TLS-options patch.
- A post-fork checkpoint at height 961640 identifies BTC:
  `00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00`.
  Genesis is shared with XBT and is insufficient. The checkpoint was independently
  read from Blockstream and mempool.space on 2026-11-08.

## Transaction and display separation

BTC creation/import supports BIP39/BIP84 Native SegWit. BTC uses standard
SIGHASH_ALL; XBT Unified signatures are refused by the BTC broadcaster. Raw
parent transaction bytes must match their transaction IDs, input values, and
owned scripts before signing. Change must belong to the wallet, and coinbase
outputs require 100 confirmations.

Balances, fee caches, transaction histories, explorers, and ticker labels are
separated by network. BTC is excluded from XBT totals and NeoxEX XBT quotes.
The shared BTC/XBT address appearance is explicitly called out before payment.

RBF/CPFP, Payjoin, external PSBT cosigning, BIP47, and Silent Payments are not
enabled for the new BTC wallet type in this draft.

## Verification

Focused tests cover offline import/restore, distinct identities for the same
seed, hidden flag restoration, deselection/background isolation, stale session
responses, wrong-chain rejection, malformed balances, parent transaction
verification, cryptographically valid BTC signatures, XBT signature refusal,
owned change, and coinbase maturity from 99 to 100 confirmations. Existing XBT
and wallet tests are also run.

A live read-only Node.js TLS smoke check connected to the Bitcoin server and
validated the checkpoint and tip. No wallet addresses or transactions were sent
in that check. It confirmed the session becomes inactive on backgrounding.

Final suite and bundle results are recorded in the pull request.

## Remaining qualification

This is a draft, not a release approval. The Electrum checkpoint and TLS do not
constitute SPV verification of the live chain. BTC currently connects directly;
the XBT Lightning Tor setting does not route this BTC backend through Tor.
Custom BTC servers and BTC Tor routing are outside this patch.

Native iOS/Android TLS certificate verification, foreground/background behavior,
camera/receive flows, and a controlled end-to-end send still require device
qualification. No native build, real payment, or TestFlight upload was performed
for this change. Existing security/native release blockers from the base branch
remain applicable.
