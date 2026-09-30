# RedWallet 0.27 prepared — transaction outcomes and price clarity

Status: tested source only; NOT imported or published. Production remains 0.26
(Caffeine revision 27), backend 7gylz-gyaaa-aaaab-qhjrq-cai. Caffeine session
expired. Secure Google authorization reached saved-account/passkey verification;
fresh project tabs still show Sign in to continue. Publication is blocked by auth.

## Implemented

- Shared wallet/history cards: received, sent, self-transfer or net wallet change;
  signed exact XBT amounts below saved block status, red/green direction styling,
  expandable transaction IDs, sent fee and balance change shown separately.
- Explicit Load transaction amounts uses existing checkpoint-verified canister
  getRawTransaction, verifies txid/canonical serialization/parents/prevouts and
  bounded values. Script ownership is derived from the authenticated account's
  validated discovered/issued addresses. Change does not count as another receipt.
  Mixed ownership reports net balance change without attributing another payer's fee.
- Raw transaction proofs persist per xpub/checkpoint, at most 200 transactions and
  1 MiB. Outcomes are recomputed on restore. Page size 20; Home shows five recent
  entries. Network reads are sequential, paced 3.5s, have 35s timeouts and pause
  on background/navigation. No automatic scan, signing or submission.
- Existing confirmed signed receipts supply outgoing amounts without new reads.
  Cached scan bytes, original timestamp, drafts and all payment gates stay intact.
- Local account balance now has an explicitly manual USD estimate, rate and set
  time; old manual settings migrate with age unknown. Small USD amounts retain
  six decimal places rather than falsely appearing as zero. No configured quote
  means unavailable. Settings distinguish XBT from BTC and fixed demo prices.
- No automatic market feed was added. The native NeoxEX public BTCB2_USDC latest
  trade endpoint returned HTTP 500 on 2026-09-30; quote currency is USDC, not USD.
  Do not silently substitute BTC pricing or assume USDC/USD parity.
- User-facing 0.27; first-launch seen marker unchanged. No backend, bridge, CSP,
  cryptographic or native-worktree changes.

## Verification

- Frontend: 58 files / 330 tests passed (previous 55 / 318).
- TypeScript, Biome (204 files, no fixes) and Vite build passed.
- Regression coverage: receiving, sending/change, self-transfer, mixed inputs,
  coinbase receipt accounting, malformed/missing/altered parents, duplicate inputs,
  impossible totals, raw-proof restore, checkpoint/cancellation, precise manual
  USD arithmetic and price timestamp migration.
- Actual component lookup/remount test: signed amounts and separate fee restored
  without any history/address scan or broadcast; saved scan bytes unchanged.
- Existing app navigation, encrypted vault, unified signatures, immutable review,
  acknowledgement, confirmation/archive and CSP tests all pass.
- Production canister read probe 2026-09-30T18:08:15.886Z: configured checkpoint,
  Fulcrum 2.1.2/protocol 1.4, tip 974890, public fixture balance 0, history 176,
  fee estimate 1000 sat/kB. Read-only actual transaction/parent accounting sanity
  also passed; no user transaction IDs/addresses are included in this repository.
- No funds prepared, signed or submitted during this iteration.

## Pending before claiming deployed

1. Restore the Caffeine signed-in project session.
2. Import the exact complete ZIP with project-menu Import code; compile and export
   it, then compare every uploaded source file before publication.
3. Publish the next Caffeine internal revision (likely 28; inspect actual UI).
4. Verify production Settings says 0.27, browser CSP/connection, retained scan and
   amount lookup/cache with the published disposable fixture; no test payment needed.
5. Ask user for one iPhone check: load amounts, navigate/background/reopen, confirm
   values remain and no address rescan is requested. No real sending needed.
