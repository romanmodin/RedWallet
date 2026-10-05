# Native live lifecycle agenda

Updated: 2026-10-05 15:12 UTC. Owner requested autonomous work, checked agenda and periodic reports.

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

Commit/push the isolated lifecycle source and run dedicated hosted workflows. Re-run live software acceptance after committing so receipts identify the actual lifecycle commit. Native UI specifications now compile; import confirmation handling, platform-specific text extraction, cancellation outcome assertions and bounded teardown are included. Hosted native execution is still pending, with no passing native receipt or publication receipt. The independent verification document is design only; the physical-device checklist is unexecuted. PR40 qualification remains separate and unchanged.
