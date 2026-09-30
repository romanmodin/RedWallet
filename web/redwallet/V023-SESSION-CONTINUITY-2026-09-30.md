# RedWallet 0.23 — prepared session-continuity fix

User reported iPhone background/reload discarded the scan and payment review,
then blocked acknowledgement/address editing. Production 0.22 persisted public
observations in memory only and required a completed scan younger than five
minutes before doing its separate live coin validation.

Changes:
- Completed public scan observations persist in local browser storage. Decode is
  bounded; every saved address is checked against authenticated account derivation.
  Restored timestamps are unchanged. Balances/history remain last-observed data.
- Public workspace is not unmounted on visibility/pagehide. The existing vault
  lifecycle still locks keys and clears secret fields on these events.
- Unsigned recipient/amount/fee draft persists across remount/reload. Checkbox,
  active review, passwords and keys never enter this storage.
- Unlock is required before preparing a review, with a direct jump to the wallet
  unlock panel. Background/lock still cancels review and in-progress preparation.
- Prepare uses cached discovery only as address hints. Current issued addresses,
  live UTXOs, exact parent transactions, fees and checkpoint are verified afresh.
  Fresh live history prevents allocating change already used by another wallet
  copy. Reservations stay durable and cancelled indices remain consumed.
- Confirmed payment invalidates only that account's scan. No automatic signing,
  broadcast, receipt replacement or transfer occurs.

Validation: typecheck and Vite build passed; Biome checked 193 files. All 53
frontend test files / 315 tests passed. Production publication is not yet claimed.
Live production canister 7gylz-gyaaa-aaaab-qhjrq-cai at
2026-09-30T04:22:32.288Z: height 974789, checkpoint verified, constrained broadcast
enabled, invalid broadcast input rejected. No real transaction was submitted.

Limits: only completed scans persist; partial discovery resumes in memory only.
The first completed scan under 0.23 is necessary to create its durable record.
Existing 0.22 in-memory results cannot be recovered after that page is discarded.
Reload requires unlocking the same local vault to authenticate its public account.
Safari/iPhone end-to-end background and funded outgoing tests remain user gates.
Version 1.0 remains reserved for the complete, verified wallet.
