# Production watch-only deployment — 2026-09-29

Caffeine version 5 is published at https://redwallet-7m3.caffeine.xyz/.
Production backend: `7gylz-gyaaa-aaaab-qhjrq-cai`.
Draft backend: `uxwok-mqaaa-aaaad-qi6ua-cai`.

Both were configured using the private Umbrel operator helper. No private
operator identity or bridge secret was copied into Caffeine or this repository.
The reviewed operator authorization, checkpoint, and migration remain intact.
No Umbrel ports, bridge container, or native worktrees were modified.

## Actual deployed-canister verification

The anonymous verification helper passed through production at
2026-09-29T15:11:31.708Z:

- Fulcrum 2.1.2, protocol 1.4, chain height 974704.
- Verified checkpoint 961640:
  `0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb`.
- Public BIP84 test address `bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu`:
  confirmed/unconfirmed balance 0/0, 176 history entries.
- Fee estimate 1000 satoshis/kB.

Draft probe passed at 15:07:10.513Z, height 974703, with the same address data.
These are actual ICP HTTPS outcalls through the authenticated Umbrel bridge,
not mocked frontend results. The single-replica reads are not chain proofs.

## Browser verification

On the public production site: added the public test address as watch-only,
loaded its zero balance and real history, verified Receive shows the exact
address and QR, and verified Send has no transaction form and explicitly says
sending is unavailable. Manual price test of 1 USD displayed fiat; cleared it
afterward. Default accounts remain clearly labelled simulated demo data.

Observed persistent header Offline while newly mounted dashboard indicators
say Connected. Quick-action hints also still mention demo for a watched address.
A narrow follow-up draft build was submitted to fix shared status propagation,
watch-only hints and getApiDoc's incorrect first-user-admin prose. That fix is
not yet verified or published. Neither canister configuration should be reset.

## Source and tests

This commit synchronizes source exported from deployed v5 with the existing
web branch. Backend differences from reviewed 77837a6d4 are Map.empty type
inference, Float.toInt syntax modernization, and a static getApiDoc mixin.
Generated Candid bindings, pnpm build policy/lock, formatting and project notes
also changed. Native signing core remains isolated and disconnected.

Re-ran exported frontend: 138 tests across 21 files passed; TypeScript and Vite
build exit 0. Caffeine could not provide original import-run test logs; those
results are not inferred from its success message. Earlier bridge/Motoko and
PocketIC evidence remains in the saved reports.

This is a working WATCH-ONLY release, not a complete spending wallet. Seed
creation/recovery, encrypted vault, HD discovery, verified UTXOs, coin selection,
transaction review, signing/broadcast and full web XBT acceptance remain open.
