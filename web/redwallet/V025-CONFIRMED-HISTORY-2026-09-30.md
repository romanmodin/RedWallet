# RedWallet 0.25 — confirmation history repair

Fixes confirmed receipts disappearing from the UI and the confirmation callback
erasing completed account discovery/history. Read the existing v1 archive format
without migration; validate original signatures, recipient, amount, fee and account.
Bound display to 100 archive reads and 10,000 storage keys; malformed/omitted records
produce a warning and remain untouched. Local confirmation labels are historical
observations, not fresh network evidence. No signing/broadcast behavior changes.

Completed scan and original timestamp survive confirmation. Balances explicitly
say “at last scan.” Preparation still refreshes coins, raw parents, checkpoint,
fees and change-address history; old balances never authorize spending. Follow-up
payment buttons retain recipient and clear amount, with fresh review and consent.

Validation: 25 focused wallet tests across 8 files, plus 19 metadata/CSP tests
across 2 files passed. TypeScript, Biome (194 files) and Vite build passed.
The integrated workspace regression confirms a published unfunded fixture,
retains incoming history and byte-identical saved scan, remounts and restores
both history and confirmed receipt with no balance scan or broadcast call.
Archive regression covers older records, mismatched IDs, corruption and isolation.

Prechange production canister probe at 2026-09-30T06:03:16.179Z passed height
974805, checkpoint verification, broadcast capability and malformed-input rejection.
Production publication is not claimed by this preparation record.

Compatibility: existing encrypted vaults, pending payments, confirmed archives,
address reservations, drafts and completed scans retain their storage keys.
If an older release already erased a completed scan, this change cannot restore
that deleted cache; Refresh account is needed once to repopulate incoming history.
The existing confirmed sent receipt is independently restored from its archive.
Native worktrees, backend/bridge and operator credentials remain untouched.
