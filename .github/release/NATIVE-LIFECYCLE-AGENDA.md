# Native live lifecycle agenda

Updated: 2026-10-06 00:40 UTC. Owner requested autonomous work, checked agenda and periodic reports.

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

The `0aed78a8024ff31c2e3fc38011e7b48a5c318a82` Android attempt 2 built and ran both native cases. Expired TLS, wrong checkpoint and cancellation assertions completed, then both failed waiting for `NavigationCloseButton`. Source inspection confirms Android left close controls use `headerBackImageSource` rather than the React control/test ID. The driver now uses Android Back to exit the Add Wallet modal and still requires WalletsList plus its visible Settings toolbar. iOS retains its actual close-button tap. No security, recovery or lifecycle assertions are waived. iOS attempt 2 and the software job were cancelled with zero steps because no runner was acquired. Driver-only correction passed targeted ESLint, tsc --noEmit, git diff --check and all four existing driver regression tests. Log: /tmp/redwallet-lifecycle-modal-validation.log. Both failed Android backend receipts identify 0aed78a80 and cleanupComplete=true. Commit/push the correction for fresh exact-source software, Android and iOS jobs. No full native acceptance, physical-device interoperability or publication receipt exists.

Source `3e4546f5f7422d62f8b336465098340a4742f31e` passed its hosted software job: 85 unit suites, 796 tests passed, one inherited skip, lint/typecheck and all three fresh isolated backend integration tests passed. Android run [37356889925](https://github.com/romanmodin/RedWallet/actions/runs/37356889925) and iOS run [37356889885](https://github.com/romanmodin/RedWallet/actions/runs/37356889885) built successfully but their native flows failed. Android passed expired TLS, wrong checkpoint and cancelled-scan assertions, then waited for WalletsList while the screenshot showed the Add Wallet modal: two backs exited discovery/import but did not close the modal. iOS failed its alert-text nonexistence wait; both screenshots show the alert visually dismissed and the underlying Electrum settings screen. The driver now explicitly closes the Add Wallet modal after cancellation and checks visual alert dismissal rather than removal of retained iOS alert text. Save still must pass its real hit test; security and incomplete-scan assertions remain intact. Qualify this driver correction on fresh exact-source hosted runs. No continuous native pass, physical-device interoperability or publication is claimed. PR40 remains frozen.

## Previous correction evidence

Latest source `555f0e20d5d87cc00cef7242f5623e93913193c7` passed committed-source software acceptance: 3 tests, 54.301s, all backend receipts identify that source and cleanupComplete=true. Its Android run 37350796639 and iOS run 37350796641 built successfully but both native cases failed. Android screenshots show a real late-request race: Stop during a stalled scan is followed by an Electrum timeout rejection and an Import error alert, masking the incomplete state. iOS original errors are now preserved: after dismissing the wrong-checkpoint alert, its UITransitionView still intercepts the next Save tap. Current correction preserves the stopped outcome and partial discoveries when a pending request rejects, with paired regression tests proving an active request still rejects. Dedicated native driver waits for alert removal and retries only unsuccessful Save taps within a bound. No native assertions are waived. Targeted recovery/import tests passed (15 tests). Corrected full unit suite passed: 85 suites, 796 tests, one inherited skip (118.575s). Targeted lint/typecheck passed. Working-tree software acceptance passed all three tests (54.573s); these receipts still identify the pre-commit HEAD and are not qualified new-source receipts. Full lint passed with only the inherited encryption-test bitwise warning. Logs: /tmp/redwallet-lifecycle-cancel-{full-unit,full-lint,tsc,live}.log. Commit/push this correction and let the dedicated hosted software job and Android/iOS flows qualify the new commit. PR40 remains frozen; the production cancellation fix is isolated here and is not released. Historical details follow.

Source `7c09b89852afaa1f6130cf1db9cc162d7f627310` was committed/pushed. Hosted Android run 37330512420 built successfully and passed its software job, but its two native cases failed: SegWit expected obsolete incomplete-recovery wording; Taproot failed during funding because the Node driver had no signing ECC initialized. iOS run 37330512560 built successfully, but both cases failed; teardown attempted to re-enable synchronization against a terminated app, masking the original failure and preventing backend cleanup. The iOS job then hit its 40-minute limit. No complete native receipt exists.

Follow-up driver-only corrections: use the current English recovery text; encode/decode public Taproot witness programs without relying on signing ECC; start the app with explicit synchronization settings; skip prelaunch blacklist setup when --reuse has not connected an app; log the original failure before bounded screenshot/termination; stop the backend before interacting with a dead app. Four regression tests pass, including invalid checksum and invalid witness length rejection. Full corrected unit suite: 85 suites, 794 tests passed, one inherited skip (123.043 seconds); full lint/typecheck passed with the existing bitwise-test warning only. Working-tree real backend regression passed all three tests (54.72 seconds). Logs: /tmp/redwallet-lifecycle-driver-{full-unit,full-lint,typecheck,lint,unit,live}.log. Commit/push this correction and rerun fresh exact-source Android/iOS gates; also rerun committed-source software acceptance and retain receipts. These corrections do not establish that the original iOS UI failure is fixed; the fresh run must reveal/verify it. No native assertion has been removed. PR40 source/workflows/publication are untouched.
