# Native live lifecycle agenda

Updated: 2026-10-05 17:45 UTC. Owner requested autonomous work, checked agenda and periodic reports.

Release qualification source: `61b7c3f521809b3b12cb88d5e49d1ae00d9e2cc6` (PR40). Leave its worktree and gates unchanged. This work is isolated on `test/native-live-lifecycle-20261005`.

## Ordered agenda

- [x] Inspect current source, existing coverage and release isolation.
- [x] Create separate native lifecycle worktree and branch.
- [x] Schedule hourly progress reports that read verified evidence.
- [x] Establish disposable Knots + real Fulcrum backend and bounded cleanup.
- [x] Add test-only TLS bridge; adapt only the pinned checkpoint and verbose address labels for regtest. Native TLS validation still requires execution.
- [x] Code native recovery → receive → spend → RBF → CPFP → confirmation → encrypted restart → deletion/recovery for BIP84/BIP86. Execution remains pending.
- [x] Pass software expired-TLS/wrong-checkpoint rejection, bounded timeout/cancellation and disconnect/reconnect.
- [ ] Execute those failure scenarios through the native Android/iOS application.
- [x] Verify backend/software harness locally with isolated, patched dependencies and bounded cleanup.
- [x] Prepare dedicated Android and iOS workflows for this isolated branch.
- [ ] Pass continuous native flow on hosted Android emulator and iOS simulator; retain source and receipts.
- [x] Write independent verification design and physical-device checklist. Neither is an implementation or physical test receipt.

## Reporting schedule

Hourly while unfinished, plus milestone updates during active work. Report completed items, tests actually run, blockers and next steps. Never convert planned coverage into a passing result. The existing release-success notification remains separate.

## Acceptance boundaries

No production node mounts, funds, credentials or private wallet data. Disposable regtest only. Existing release source stays frozen. No independent SPV claim; no physical phone/cold device claim. Separate source qualification from publication receipts.

## Evidence so far

- Full lint/typecheck passed on isolated dependencies (one existing encryption-test bitwise warning; no errors).
- Full unit suite: 84 suites passed, 790 tests passed, one explicitly skipped (146.172 seconds).
- Fresh real-backend software regression: three tests passed (54.207 seconds). BIP84/BIP86 each reached height 159 with send/RBF/CPFP acceptance and confirmed transactions, encrypted history restart and delete/recovery. Mutated Unified signature rejection is asserted at Knots.
- Expired certificate rejected before checkpoint RPC, wrong checkpoint rejected, recovery cancellation and bounded history timeout failed safely, actual injected disconnect observed and authenticated reconnect succeeded.
- All three backend receipts reported cleanupComplete=true; no disposable data directories remained.
- Local evidence: /tmp/redwallet-lifecycle-full-lint-isolated.log, /tmp/redwallet-lifecycle-unit-isolated.log, /tmp/redwallet-lifecycle-live-final.log, /tmp/redwallet-lifecycle-typecheck-final.log and artifacts/native-lifecycle/*/backend-receipt.json.

## Dependency qualification correction

The initial software run shared an older dependency installation lacking this source's Electrum TLS patch. An added expired-certificate test exposed that mismatch. Replaced the symlink with an isolated npm ci installation; patch-package applied current Electrum and native TCP patches, and all results above were rerun against those dependencies. Earlier shared-dependency results are not exact-source TLS qualification.

## Current task and next step

Source `7c09b89852afaa1f6130cf1db9cc162d7f627310` was committed/pushed. Hosted Android run 37330512420 built successfully and passed its software job, but its two native cases failed: SegWit expected obsolete incomplete-recovery wording; Taproot failed during funding because the Node driver had no signing ECC initialized. iOS run 37330512560 built successfully, but both cases failed; teardown attempted to re-enable synchronization against a terminated app, masking the original failure and preventing backend cleanup. The iOS job then hit its 40-minute limit. No complete native receipt exists.

Follow-up driver-only corrections: use the current English recovery text; encode/decode public Taproot witness programs without relying on signing ECC; start the app with explicit synchronization settings; skip prelaunch blacklist setup when --reuse has not connected an app; log the original failure before bounded screenshot/termination; stop the backend before interacting with a dead app. Four regression tests pass, including invalid checksum and invalid witness length rejection. Full corrected unit suite: 85 suites, 794 tests passed, one inherited skip (123.043 seconds); full lint/typecheck passed with the existing bitwise-test warning only. Working-tree real backend regression passed all three tests (54.72 seconds). Logs: /tmp/redwallet-lifecycle-driver-{full-unit,full-lint,typecheck,lint,unit,live}.log. Commit/push this correction and rerun fresh exact-source Android/iOS gates; also rerun committed-source software acceptance and retain receipts. These corrections do not establish that the original iOS UI failure is fixed; the fresh run must reveal/verify it. No native assertion has been removed. PR40 source/workflows/publication are untouched.
