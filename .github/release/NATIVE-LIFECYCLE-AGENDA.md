# Native live lifecycle agenda

## Focused native qualification (October 6, 2026)

- [x] Split native execution into seven independently reset stages: recovery/resilience, receive, send, RBF, CPFP, encryption/restart/history, deletion/recovery. Every stage runs for SegWit and Taproot with a fresh app and isolated Knots/Fulcrum backend.
- [x] CPFP creates its own native parent payment without depending on RBF. Encryption and deletion create and confirm their own native payment without depending on fee bumps. Prerequisite failures are reported with their exact step.
- [x] Keep full uninterrupted lifecycle behind explicit final mode. Hosted final jobs fail closed until all seven focused jobs passed on both platforms at the same source commit.
- [x] Disable matrix fail-fast; retain separate stage artifacts and screenshots. Limit concurrency to two stages per platform.
- [ ] Pass focused native stages on Android and iOS.
- [ ] After all focused stages pass on the same source, dispatch and pass uninterrupted final acceptance on both platforms.

Push runs all focused stages. Workflow dispatch stage selects a single stage or focused; final is reserved for the last acceptance run. Stage receipts mark continuousAcceptance=false; only final can mark it true. These remain hosted emulator/simulator tests, not physical-phone or cold-device interoperability.


## CPFP eligibility, fee approval and launcher focus (October 6, 2026)

- [x] Inspect 98770e06a exact-source failures and retained traces: Android Quickstep ANR before wallet readiness; iOS SegWit hides CPFP for outgoing change; iOS Taproot waits at the real high-fee confirmation.
- [x] Let XBT SegWit CPFP eligibility recognize an unspent owned change output, verifying parent identity, output index, amount and script. Preserve the existing BTC path.
- [x] Derive the Taproot child fee from the retained signed parent, require the real high-fee warning when applicable, and tap its localized Yes once. No Broadcast/Create retry or approval bypass.
- [x] Stop only the disposable Android emulator's Quickstep launcher immediately after app launch, before wallet readiness assertions. Native app errors remain failures.
- [x] Pass 25 targeted eligibility/review tests; full lint/typecheck passed with only the inherited encryption-test warning.
- [x] Pass full lint/typecheck and 91 unit suites: 836 passed, one inherited skip (113.507s), VALIDATION_EXIT:0. Final driver typecheck passed TSC_EXIT:0.
- [ ] Pass fresh committed-source hosted software/backend and both native lifecycle flows.

98770e06a passed 90 unit suites (825 tests, one skipped), lint/typecheck, three real Fulcrum/Knots software tests and both native builds. All seven retained backend receipts match that source and report cleanupComplete=true. Android run37557319117 failed both cases at initial window focus; device logs identify com.android.launcher3 ANR, not a demonstrated RedWallet crash. iOS run37557319055 reached original and RBF acceptance in both formats. SegWit failed looking for TransactionCpfpButton because the old net-positive test excluded outgoing change. Taproot's retained view hierarchy shows High transaction fee awaiting approval after the Broadcast tap; only two broadcasts reached the backend. No native lifecycle pass is claimed.

Validation logs: /tmp/redwallet-cpfp-targeted.log, /tmp/redwallet-cpfp-lint-final.log, /tmp/redwallet-cpfp-unit-final.log, /tmp/redwallet-cpfp-validation-result.txt. Continuous native acceptance, physical-phone/cold-device interoperability and the separately reported public Android Send crash fix remain unproven. PR40 qualification/publication is separate.

## Visible gesture origins (October 6, 2026)

- [x] Inspect aa1d7e8 failures: Android Import is obscured; iOS SegWit fails the keyboard-dismissal swipe after text entry, and Taproot fails the transaction scroll whose default origin is below visible bounds.
- [x] Make Android reveal Import through the actual form before its real tap. Start iOS keyboard-dismissal gestures above the keyboard at the form edge, and transaction scrolling inside the visible viewport.
- [x] Pass 14 targeted keyboard/navigation regression tests; targeted ESLint, typecheck and diff checks passed. Logs: /tmp/redwallet-viewport-targeted.log and /tmp/redwallet-viewport-validation-result.txt (VALIDATION_EXIT:0).
- [ ] Pass fresh exact-source hosted software/backend and both native lifecycle flows.

This correction changes only the test driver and regression coverage. Original visibility, keyboard-absence, retained input, payment, signature, output and Knots checks remain required. No Create/Broadcast retry is introduced. aa1d7e8 software and both builds passed, but both native suites failed. Complete native lifecycle and physical/cold-device interoperability remain unproven; PR40 release qualification is separate.


Updated: 2026-10-06 08:50 UTC. Owner requested autonomous work, checked agenda and periodic reports. Latest correction/evidence is in the Keyboard submission and alert transitions section below. Fresh hosted qualification of this follow-up remains pending.

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

Source bfb1bb573f2ed8330abe842731d02304384a566e Android run37395218316 built and passed software checks, then both native cases opened Send, entered recipient/amount/fee and tapped CreateTransactionButton. Both timed out waiting for TransactionValue. Downloaded screenshots show the app alive with an empty recipient; SegWit displays The address is not valid. Neither device log contains FATAL EXCEPTION or Fatal signal. The driver now types the recipient through the keyboard and asserts its exact retained value before and after fee selection. Source review also found the driver omitted the required Confirm XBT payment alert, which gates preparation in production. The driver now requires the warning title and taps its real localized Yes button before waiting for transaction review. No production warning or signing assertion is bypassed. Fresh native qualification is required. This test timeout is not evidence that the separately reported Pixel/GrapheneOS public-release crash has been reproduced or fixed; that still needs an exact build and redacted crash trace. PR40 remains separate and frozen.


The `0aed78a8024ff31c2e3fc38011e7b48a5c318a82` Android attempt 2 built and ran both native cases. Expired TLS, wrong checkpoint and cancellation assertions completed, then both failed waiting for `NavigationCloseButton`. Source inspection confirms Android left close controls use `headerBackImageSource` rather than the React control/test ID. The driver now uses Android Back to exit the Add Wallet modal and still requires WalletsList plus its visible Settings toolbar. iOS retains its actual close-button tap. No security, recovery or lifecycle assertions are waived. iOS attempt 2 and the software job were cancelled with zero steps because no runner was acquired. Driver-only correction passed targeted ESLint, tsc --noEmit, git diff --check and all four existing driver regression tests. Log: /tmp/redwallet-lifecycle-modal-validation.log. Both failed Android backend receipts identify 0aed78a80 and cleanupComplete=true. Commit/push the correction for fresh exact-source software, Android and iOS jobs. No full native acceptance, physical-device interoperability or publication receipt exists.

Source `3e4546f5f7422d62f8b336465098340a4742f31e` passed its hosted software job: 85 unit suites, 796 tests passed, one inherited skip, lint/typecheck and all three fresh isolated backend integration tests passed. Android run [37356889925](https://github.com/romanmodin/RedWallet/actions/runs/37356889925) and iOS run [37356889885](https://github.com/romanmodin/RedWallet/actions/runs/37356889885) built successfully but their native flows failed. Android passed expired TLS, wrong checkpoint and cancelled-scan assertions, then waited for WalletsList while the screenshot showed the Add Wallet modal: two backs exited discovery/import but did not close the modal. iOS failed its alert-text nonexistence wait; both screenshots show the alert visually dismissed and the underlying Electrum settings screen. The driver now explicitly closes the Add Wallet modal after cancellation and checks visual alert dismissal rather than removal of retained iOS alert text. Save still must pass its real hit test; security and incomplete-scan assertions remain intact. Qualify this driver correction on fresh exact-source hosted runs. No continuous native pass, physical-device interoperability or publication is claimed. PR40 remains frozen.

## Previous correction evidence

Latest source `555f0e20d5d87cc00cef7242f5623e93913193c7` passed committed-source software acceptance: 3 tests, 54.301s, all backend receipts identify that source and cleanupComplete=true. Its Android run 37350796639 and iOS run 37350796641 built successfully but both native cases failed. Android screenshots show a real late-request race: Stop during a stalled scan is followed by an Electrum timeout rejection and an Import error alert, masking the incomplete state. iOS original errors are now preserved: after dismissing the wrong-checkpoint alert, its UITransitionView still intercepts the next Save tap. Current correction preserves the stopped outcome and partial discoveries when a pending request rejects, with paired regression tests proving an active request still rejects. Dedicated native driver waits for alert removal and retries only unsuccessful Save taps within a bound. No native assertions are waived. Targeted recovery/import tests passed (15 tests). Corrected full unit suite passed: 85 suites, 796 tests, one inherited skip (118.575s). Targeted lint/typecheck passed. Working-tree software acceptance passed all three tests (54.573s); these receipts still identify the pre-commit HEAD and are not qualified new-source receipts. Full lint passed with only the inherited encryption-test bitwise warning. Logs: /tmp/redwallet-lifecycle-cancel-{full-unit,full-lint,tsc,live}.log. Commit/push this correction and let the dedicated hosted software job and Android/iOS flows qualify the new commit. PR40 remains frozen; the production cancellation fix is isolated here and is not released. Historical details follow.

Source `7c09b89852afaa1f6130cf1db9cc162d7f627310` was committed/pushed. Hosted Android run 37330512420 built successfully and passed its software job, but its two native cases failed: SegWit expected obsolete incomplete-recovery wording; Taproot failed during funding because the Node driver had no signing ECC initialized. iOS run 37330512560 built successfully, but both cases failed; teardown attempted to re-enable synchronization against a terminated app, masking the original failure and preventing backend cleanup. The iOS job then hit its 40-minute limit. No complete native receipt exists.

Follow-up driver-only corrections: use the current English recovery text; encode/decode public Taproot witness programs without relying on signing ECC; start the app with explicit synchronization settings; skip prelaunch blacklist setup when --reuse has not connected an app; log the original failure before bounded screenshot/termination; stop the backend before interacting with a dead app. Four regression tests pass, including invalid checksum and invalid witness length rejection. Full corrected unit suite: 85 suites, 794 tests passed, one inherited skip (123.043 seconds); full lint/typecheck passed with the existing bitwise-test warning only. Working-tree real backend regression passed all three tests (54.72 seconds). Logs: /tmp/redwallet-lifecycle-driver-{full-unit,full-lint,typecheck,lint,unit,live}.log. Commit/push this correction and rerun fresh exact-source Android/iOS gates; also rerun committed-source software acceptance and retain receipts. These corrections do not establish that the original iOS UI failure is fixed; the fresh run must reveal/verify it. No native assertion has been removed. PR40 source/workflows/publication are untouched.

## Recipient state and alert hit-test correction

The latest `14eee7927c93f4069a759fc601f7f1568688c7fb` source passed hosted software acceptance (85 suites, 796 tests, one inherited skip, lint/typecheck and three fresh backend integration tests) and both native builds. Android `37397847410` and iOS `37397847230` each failed both native cases. Android's address is empty after amount/fee entry; iOS fails its dismissed-alert visibility assertion. Downloaded iOS failure screenshots show the settings form with no alert.

Source inspection found the amount callback could replace a newly cloned recipient with its captured old render object. It now updates a cloned current recipient by stable key, preserving its latest address/unit and ignoring events for deleted recipients. Regression tests cover address-then-delayed-amount ordering, immutable prior state, recipient reordering and deletion. The native driver additionally checks address retention immediately after amount entry and again after fee selection.

The iOS driver requires a successful tap on the underlying Host field after tapping the real alert OK. This checks that the alert/transition no longer blocks user interaction; it then dismisses the keyboard and returns to Save. Expired TLS/checkpoint rejection assertions and payment/signing gates remain intact. Targeted lint, typecheck, six unit tests and diff check passed. Full lint/typecheck passed with only the inherited encryption-test bitwise warning; all 86 unit suites and 798 tests passed with one inherited skip (FULL_VALIDATION_EXIT:0). Logs: /tmp/redwallet-lifecycle-recipient-validation.log and /tmp/redwallet-lifecycle-recipient-full-validation.log. Fresh committed-source software/backend and hosted native qualification are required. These corrections remain isolated and do not establish the reported public-release Pixel/GrapheneOS crash is fixed. PR40 remains separate.


## Exact transaction selection and hosted setup

Source `2981a5869c50ae2a97dbe5d19cc8f70990c751e8` passed hosted software acceptance (86 suites, 798 tests, one inherited skip, lint/typecheck and three fresh real-backend integration tests). Android [37419384968](https://github.com/romanmodin/RedWallet/actions/runs/37419384968) and iOS [37419384980](https://github.com/romanmodin/RedWallet/actions/runs/37419384980) built successfully but both native cases failed. All four native backend receipts identify that source and cleanupComplete=true; retained in /tmp/redwallet-lifecycle-2981-{android,ios}-evidence. Three committed-source software cleanup receipts are in /tmp/redwallet-lifecycle-2981-software-monitor-evidence.

Android SegWit reached native transaction review, Unified-signature/output assertions, real broadcast and Knots mempool acceptance, then failed a Sent-label matcher. Its screenshot shows the outgoing row labeled Pending. The driver now selects the exact transaction by a stable transaction-row test ID and still verifies the opened transaction ID, including after fee bumps and restart. Android Taproot retained its recipient but its Next tap overlapped the fee screen's return transition; no warning appeared and the screenshot shows Send alive. A bounded retry requires the real XBT warning and its localized Yes button. No retry occurs after approving preparation, and no error dialog or security/signing assertion is bypassed.

The iOS SegWit AbortError occurred before native launch. The retained isolated Knots log shows first fixture-wallet loading took 22581ms, beyond the original 10-second RPC deadline. Wallet creation and initial bootstrap mining now have bounded 60-second deadlines; mutating RPCs are never retried. Timeout diagnostics name the operation without parameters/cookies. Two regression tests verify bounded abort, no retry, timer cleanup and preservation of ordinary RPC errors. Explicit safe phase markers distinguish backend startup, funding and app launch. The iOS Taproot screenshot shows the host already set to loopback, while the driver still sought its placeholder. Alert dismissal now scrolls to the host and hit-tests its current value, then dismisses the keyboard and returns to Save.

Full lint/typecheck passed with only the inherited encryption-test bitwise warning. All 87 unit suites and 800 tests passed, one inherited skip; log /tmp/redwallet-lifecycle-flow-full-validation.log, FULL_VALIDATION_EXIT:0. Targeted final checks are in /tmp/redwallet-lifecycle-flow-targeted-final.log. Commit/push the correction and qualify its actual new source with fresh hosted software/backend, Android and iOS runs. Continuous native acceptance, physical-phone/cold-device interoperability and the separately reported public-release Android crash fix remain unproven. PR40 stays separate and frozen; no publication is claimed.


## Keyboard submission and alert transitions

- [x] Inspect exact-source e9962437340a38ad58f9649bbec19a967eb57c97 hosted results, native failure screens/traces and backend cleanup receipts.
- [x] Correct Android fee entry and iOS connection-alert transition handling without bypassing payment, TLS, checkpoint or signing assertions.
- [x] Pass local full lint/typecheck and 87 unit suites (800 tests passed, one inherited skip); final targeted lint/typecheck, eight regression tests and diff check passed.
- [ ] Pass fresh committed-source hosted software/backend, Android and iOS native qualification of this follow-up.

The e996 source passed hosted software lint/typecheck, 800 unit tests (one inherited skip) and three real-backend integration tests. Both native builds passed, but Android [37430029882](https://github.com/romanmodin/RedWallet/actions/runs/37430029882) and iOS [37430029908](https://github.com/romanmodin/RedWallet/actions/runs/37430029908) failed both native cases. All three software and four native backend receipts identify e996 and cleanupComplete=true. Software receipts: /tmp/redwallet-lifecycle-e996-software-evidence; Android full artifact: /tmp/redwallet-lifecycle-e996-android-evidence; iOS receipts retrieved with CRC-verified artifact byte ranges: /tmp/redwallet-lifecycle-e996-ios-receipts. Full iOS evidence is downloading to /tmp/redwallet-lifecycle-e996-ios-evidence; CRC-verified early screenshots/traces are also retained in /tmp/redwallet-e996-ios-partial.

Both Android formats reached native review, Unified-signature and recipient/output assertions, original broadcast and Knots mempool acceptance before RBF. The failure screenshots show Transaction Status rather than the fee-bump form. The trace confirms replaceText followed by Android Back then a missing FeeBumpCreateButton: Back navigated away with no keyboard open. Fee entry now focuses/clears/types through the keyboard and submits Android with the same newline pattern already used by the passing custom payment fee helper. It never uses Back to dismiss the fee keyboard. iOS uses its localized Done accessory. The driver then requires the fee field to remain visible, the exact requested fee value and the real Create button before continuing. Create/broadcast are not retried or bypassed; signed hex and real-node assertions remain required.

Both iOS cases reached the expired-certificate rejection, with invalidCertificateTested=true and checkpointRequests=0. Their next scroll failed because a UITransitionView intercepted the immediate scroll after OK. The final SegWit failure screenshot shows the alert gone and loopback host visible at the saved form position. The driver now retries the real host-field tap within 15 seconds before any scroll, then dismisses the keyboard and retries only the nonmutating scroll-to-bottom gesture within 15 seconds. It does not resubmit a rejected connection to dismiss its alert. Wrong-checkpoint, cancellation and complete iOS lifecycle acceptance still require the new run.

Local logs: /tmp/redwallet-lifecycle-keyboard-transition-validation.log (VALIDATION_EXIT:0, 123.478s unit suite) and /tmp/redwallet-lifecycle-keyboard-transition-final.log (FINAL_EXIT:0). A naming warning introduced during the first lint pass was removed and final targeted lint/typecheck are clean; the inherited encryption-test bitwise warning is unchanged. This is a driver-only follow-up. Complete continuous native acceptance, physical-phone/cold-device interoperability and the independently reported public Android crash fix remain unproven. PR40 source/gates/publication stay separate and untouched.


## RBF viewport and already-dismissed mnemonic keyboard

Updated 2026-10-06 14:50 UTC; follow-up to source 6de606a4d93b45f4157979c647b7134f7b508cb4.

- [x] Read exact-source Android/iOS failed-job logs and retained failure screenshots.
- [x] Correct the RBF driver to scroll the existing fee-bump form until Create is visible; add only a stable test ID to that ScrollView.
- [x] Correct iOS mnemonic keyboard handling: tap the real Done accessory if available, otherwise require the onscreen keyboard to be absent and Import visible.
- [x] Pass 11 targeted tests and targeted ESLint/diff checks, including five keyboard-driver regressions.
- [x] Pass full local lint/typecheck and 88 unit suites: 805 tests passed, one inherited skip, VALIDATION_EXIT:0 (121.416s unit suite).
- [ ] Commit/push and pass fresh exact-source hosted software/backend, Android and iOS qualification.

Current 6de runs Android37438833040 and iOS37438833160 both completed failure, with software and both builds successful. Android both formats retain exact fee4 and show the RBF form alive, keyboard closed, with the Create button below the viewport. The driver must scroll rather than waive its visibility check. iOS both formats pass the cancelled scan and stop on the second recovery waiting for Done; the retained SegWit failure screenshot shows Import and no onscreen keyboard. A repeated tap on the mnemonic input is no longer used to demand an accessory when the keyboard is closed. New unit tests require failure within ten seconds if the keyboard remains open or Import is hidden; Android handling is unchanged. Exact mnemonic retention, fee retention before/after scroll, actual Import/Create/Broadcast taps, Unified signature checks, recipient/output checks and Knots acceptance remain required. No Create/Broadcast retry is introduced.

Evidence screenshots are in /tmp/redwallet-6de-android-images and /tmp/redwallet-6de-ios-images. Full Android evidence download is in progress to /tmp/redwallet-lifecycle-6de-android-evidence. Validation log: /tmp/redwallet-lifecycle-scroll-keyboard-validation.log. Complete native lifecycle, physical-phone/cold-device interoperability and the independently reported public Android crash fix remain unproven. PR40 stays separate; no publication is claimed.


## Fee-bump return, unset biometrics and recovery scrolling

Updated 2026-10-06 18:57 UTC; follow-up to source 1d997f9ff980ddf2883016eba89d3c9edefa3343.

- [x] Inspect exact-source Android/iOS failed jobs, native traces, failure screenshots and seven backend cleanup receipts.
- [x] Correct fee-bump Done to pop the current wallet stack to its existing WalletTransactions route; preserve normal-send modal dismissal.
- [x] Handle the native secure store's specific missing Biometrics preference result on a fresh installation; retain enabled-biometric authentication, high-fee approval, reviewed-hex binding and failure on other storage errors.
- [x] Let import content grow beyond the viewport and keep the multiline input at least 120 points tall, so discovery controls cannot collapse it. Add drag-to-dismiss behavior and require the native driver to reveal discovery/input controls, dismiss the onscreen keyboard and reveal Import through actual UI gestures.
- [x] Pass 27 targeted regression tests covering wallet-stack return, fee-bump authentication/storage gates and keyboard dismissal/visibility.
- [x] Pass full local lint/typecheck and 89 unit suites: 818 passed, one inherited skip (112.738s), FULL_EXIT:0. Final targeted lint/typecheck/diff checks after the layout adjustment passed, FINAL_CHECKS_EXIT:0.
- [ ] Pass fresh committed-source backend acceptance.
- [ ] Pass new exact-source hosted software/backend and both native flows.

The 1d997 source passed hosted software lint/typecheck, 805 unit tests (one inherited skip), three real-backend software tests and both native builds. Android [37482649867](https://github.com/romanmodin/RedWallet/actions/runs/37482649867) and iOS [37482649919](https://github.com/romanmodin/RedWallet/actions/runs/37482649919) failed both native cases. All seven retained backend receipts identify 1d997 and cleanupComplete=true.

Android SegWit reached original send and replacement acceptance at Knots, then remained on Success after Done. Success is registered in both SendDetailsStack and the wallet DetailViewStack; its unconditional parent goBack targeted the wrong navigator after a fee bump. Router regression tests now verify the actual pop action preserves the existing wallet route and params.

Android Taproot reached original acceptance and signed replacement review, but its backend receipt contains only the original broadcast. The native log at 15:16:46.922 UTC reports FileNotFoundException: Biometrics has not been set. The fee-bump broadcast path read the unset preference without the normal biometric hook's missing-key handling. The correction recognizes only the native 404 missing-setting contract, and tests still block unrelated 404s and keystore failures.

iOS SegWit failed with an open keyboard lacking Done; Taproot failed waiting for input visibility. The import ScrollView now supports real drag dismissal. The driver verifies keyboard absence and actual Import visibility and retains mnemonic/fee/signature/output/Knots assertions; it does not retry Create or Broadcast. Full local validation passed with only the inherited encryption-test bitwise warning; logs /tmp/redwallet-lifecycle-return-full-validation.log and /tmp/redwallet-lifecycle-return-biometric-targeted.log. Final checks are logged in /tmp/redwallet-lifecycle-return-final-checks.log. No complete native pass, physical-phone/cold-device interoperability, public Android crash fix or publication is claimed. PR40 stays separate.


## Cancelled recovery return transitions

Updated 2026-10-06; follow-up to source 712a187ac8a41a1fc39b2696d33a3e453f8b4b21.

- [x] Inspect current Android/iOS failed jobs, both Android failure screenshots, iOS failure screenshot/traces and all four native backend cleanup receipts.
- [x] Require the import form and Add Wallet screen to arrive after their respective Back actions; close the actual modal and require it to disappear before checking the home toolbar. Only the nonmutating Close tap is retried while the Add Wallet screen remains visible, within a bound.
- [x] Pass 13 targeted driver tests, targeted ESLint, typecheck and diff checks; six new regressions cover delayed stack transitions, a lost Close tap, missing destination screens, bounded close failure and Android's native Back close.
- [x] Pass full lint/typecheck and 90 unit suites: 824 tests passed, one inherited skip (111.82s), FULL_EXIT:0; only the inherited encryption-test bitwise warning remains.
- [ ] Commit/push and pass fresh exact-source hosted software/backend, Android and iOS qualification.

Source 712a187 passed hosted software lint/typecheck, 89 unit suites (818 tests passed, one inherited skip, 126.241s), three real Fulcrum/Knots software tests (48.843s) and both native builds. Its earlier local committed-source backend acceptance passed three tests, with all three receipts identifying 712a187 and cleanupComplete=true, retained in /tmp/redwallet-lifecycle-712a187-software-evidence.

Android [37515622521](https://github.com/romanmodin/RedWallet/actions/runs/37515622521) failed both native cases at initial waitForWalletsList. Both retained failure screenshots show the Android launcher dialog 'Quickstep is not responding' over RedWallet's home screen. The recorded app window lacked focus. This run does not establish a RedWallet app crash or qualify its full native lifecycle. Requalify on a fresh hosted emulator; the launcher failure is not waived.

iOS [37515622474](https://github.com/romanmodin/RedWallet/actions/runs/37515622474) failed both cases after expired TLS, wrong checkpoint and cancelled-scan assertions. Its failure screenshot shows Add Wallet still open. The trace contains two immediate Back taps followed by Close before requiring the intermediate destination screens, then a home-toolbar timeout. The correction explicitly waits for those transitions and verifies actual modal dismissal. No payment, cancellation, TLS, checkpoint, signature, output or Knots assertion is waived; Create/Broadcast are never retried.

All four native cleanup receipts identify 712a187 and cleanupComplete=true. Both iOS receipts have invalidCertificateTested=true. Android evidence: /tmp/redwallet-712a187-android-evidence. iOS CRC-verified screenshot evidence: /tmp/redwallet-712a187-ios-images; traces/receipts: /tmp/redwallet-712a187-ios-traces. Full iOS evidence is downloading to /tmp/redwallet-712a187-ios-evidence. Targeted validation: /tmp/redwallet-lifecycle-modal-transition-targeted.log, TARGETED_EXIT:0. Full validation: /tmp/redwallet-lifecycle-modal-transition-full.log. This follow-up changes the test driver only. Complete native app-to-real Fulcrum-to-Knots acceptance, physical-phone/cold-device interoperability and the separately reported public Android Send crash fix remain unproven. PR40 remains separate; no publication is claimed.

## Focused driver corrections (October 7 UTC / October 6 PDT)

- [x] Inspect all completed focused jobs at source 5e6edbd653e1d1fc9d94bf97ec37758645c1c3fd. Android recovery/send and iOS receive passed both formats in job logs; remaining focused jobs failed. The software gate and both builds passed.
- [x] Reveal the home carousel's Add Wallet card, tap once and wait for import destinations. Wait for Electrum settings and reviewed transaction hex before acting on newly navigated screens.
- [x] Add CPFP's missing FeeBumpScroll identifier; use the existing WalletDetails action for deletion.
- [x] Check the actual wrong-password rejection behavior: input clears while the wallet stays locked, then a correct password must restore the retained balance/history.
- [x] Target the real mnemonic keyboard Done accessory by a unique identifier. Keyboard absence, Import visibility and retained input remain mandatory.
- [x] Bound hosted Mac createwallet setup at 120 seconds without retrying the mutating RPC.
- [x] Pass local lint/typecheck, all eight mnemonic keyboard-driver regressions and diff checks (VALIDATION_EXIT:0). Only the inherited encryption-test bitwise warning remains. Log: /tmp/redwallet-focused-corrections-validation.log.
- [ ] Pass new exact-source focused native qualification on both platforms, then the separately gated uninterrupted final runs.

These corrections preserve payment/signature/output/mempool, TLS/checkpoint, cancellation, encryption/history and delete/recovery assertions. No signing/broadcast retry or test result waiver is introduced. Prior passes do not qualify this new source. Hosted execution remains distinct from physical-phone and cold-device interoperability; PR40 release qualification/publication stays separate.


## Remaining focused timing and iOS prompt failures — October 7, 2026

- [x] Inspect completed source 6f982018847d1d6609a4fe622bdf3162ed2a9074 runs: [Android 37581860605](https://github.com/romanmodin/RedWallet/actions/runs/37581860605), [iOS 37581860911](https://github.com/romanmodin/RedWallet/actions/runs/37581860911). Both builds and the software gate passed: 91 unit suites, 836 tests passed, one skip, three real Fulcrum/Knots software tests. Android recovery/receive/send/CPFP/encryption and iOS receive/send/CPFP passed both formats. These results qualify only that source and those focused stages.
- [x] Inspect retained failure artifacts. The iOS SegWit RBF screenshot has Speed Up present after the driver's premature scroll failure; wait for asynchronously queried eligibility before scrolling. The Taproot encryption confirmation screenshot remains on the transaction list; retry a lost row tap only while the exact row and list remain visible.
- [x] Wait for every encryption settings destination before tapping its next action. Preserve wrong-password rejection, correct-password unlock and retained history/balance assertions.
- [x] Replace the obsolete private iOS alert text-field class selector with UIKit's public UITextField type and wait for the second prompt. Retry only the initial Delete prompt opener on Details; never repeat either confirmed deletion action.
- [x] Permit ordinary background taps to dismiss the import keyboard and exercise a noninteractive form-label tap when the multiline input's accessory is absent. Still require keyboard absence, visible Import and unchanged mnemonic text. Add fallback regression coverage.
- [x] Pass full local lint/typecheck and all nine mnemonic keyboard-driver regressions (VALIDATION_EXIT:0). Retained logs: /tmp/redwallet-remaining-final-lint.log and /tmp/redwallet-remaining-unit.log. No hosted result is inferred from local checks.
- [ ] Commit/push and qualify the corrected source.
- [ ] Pass all seven focused stages for both formats on both platforms on the new exact source. Only then dispatch the separately gated uninterrupted final tests.

No fee/signature/output/mempool, TLS/checkpoint, cancellation, encryption/history or delete/recovery assertion is waived. Signing and broadcasting are not retried. Focused hosted simulator/emulator execution and software-backend acceptance do not establish uninterrupted native lifecycle completion, physical-phone or cold-device interoperability. PR40 release qualification and publication remain separate.

## Native keyboard and confirmation corrections — October 7, 07:36–07:50 PDT

- [x] Verified predecessor 60962f75a: Android receive/recovery/send/RBF/CPFP/encryption pass; delete fails. iOS receive/send/RBF/CPFP pass; recovery/encryption/delete fail. No final acceptance.
- [x] Retained iOS recovery trace identifies NSNull DetoxSync animation-untracking exception during scroll-to-top. Replace gesture fallback with the actual mnemonic keyboard Done action; field now explicitly uses blurAndSubmit. Keep keyboard-absence, Import visibility and unchanged-mnemonic checks.
- [x] Focus secure password fields before typing, avoiding clearTextOnFocus erasing an unfocused confirmation during submission.
- [x] Android native alert helper waits for a unique visible button without atIndex and performs one tap. Propagate uncertain tap failures; never repeat a confirmation.
- [x] Thirteen focused keyboard/alert regressions pass; complete lint/typecheck and diff whitespace checks pass. Logs: /tmp/redwallet-dialog-unit.log and /tmp/redwallet-dialog-lint.log.
- [ ] Hosted replacement qualification: all seven separately reset stages, both formats, both platforms. These corrections are hypotheses until hosted receipts verify them.
- [ ] Final continuous native lifecycle only after every exact-source focused stage passes. No physical-phone/cold-device interoperability or PR40 publication claim.


## Exact-source 58c69fe1 focused qualification — October 7, 08:23 PDT

- [x] Verified clean pushed source `58c69fe1a72b2e75db43b9e60c421d4a93debc4e` before hosted execution. [Android 37639112642](https://github.com/romanmodin/RedWallet/actions/runs/37639112642) and [iOS 37639112707](https://github.com/romanmodin/RedWallet/actions/runs/37639112707) both built; the shared exact-source software/backend gate passed.
- [x] Android recovery, receive, send, RBF and CPFP passed. iOS encryption passed. Android deletion, iOS recovery and iOS CPFP remain active; remaining iOS stages are queued.
- [x] Retained Android encryption evidence shows SegWit completed. Taproot reached its preliminary send but stopped before signing/broadcast when the focused `feeCustom` input existed below Detox's 75%-visible threshold after the numeric keyboard resized the screen. This is a driver visibility fault, not evidence of an encryption defect.
- [x] Prepared a bounded local correction: identify the real fee ScrollView and scroll only until the focused custom-fee input is visible before typing. Two focused regressions pass, affected-file ESLint passes, TypeScript passes, and `git diff --check` passes.
- [ ] Preserve currently active hosted evidence. Do not push the local correction until all healthy source-58c69fe1 jobs finish.
- [ ] After the active runs finish, inspect every failure receipt, incorporate any additional evidence-based corrections, commit/push once, and requalify all affected/requisite exact-source stages. Dispatch the final continuous lifecycle only after all seven focused stages pass on both platforms and both wallet formats.

No payment, signature, output, mempool, TLS/checkpoint, cancellation, encryption/history, deletion or recovery assertion is skipped or weakened. The local fee correction has not yet been committed and has no hosted qualification. Hosted simulator/emulator evidence does not establish physical-phone or cold-device interoperability; PR40 release qualification and publication remain separate.


## Evidence-based follow-up — 2026-10-07 10:30 PDT

- [x] Refreshed local/remote source `58c69fe1a72b2e75db43b9e60c421d4a93debc4e`; all prior focused jobs completed before replacement push. Preserved the earlier uncommitted fee visibility correction and agenda entry.
- [x] Android [37639112642](https://github.com/romanmodin/RedWallet/actions/runs/37639112642): software and build passed; recovery, receive, send, RBF, CPFP passed; encryption and delete failed. iOS [37639112707](https://github.com/romanmodin/RedWallet/actions/runs/37639112707): build passed; recovery, receive, send, RBF, encryption passed; CPFP and delete failed. Five of seven stages per platform passed on this predecessor source only.
- [x] Android encryption failure was Taproot's preliminary fee entry below the visibility threshold. Added SelectFeeScroll testID and real form scrolling before typing; no visibility assertion or signing gate bypassed.
- [x] iOS Taproot delete/recovery failed because Import was below the viewport after the keyboard had already closed. Separated keyboard dismissal from revealing Import, avoiding repeated Done taps during scrolling; retained the 10-second keyboard deadline and real Import hit test. Added delayed-scroll regression.
- [x] Retained iOS CPFP evidence proves SegWit recovery failed with an Electrum request timeout and incomplete scan, not merely an alert transition. Added per-method response counts, maximum latency and unanswered counts to backend receipts; no request parameters or response values recorded. Complete-recovery helper now explicitly rejects incomplete results; intentional incomplete-scan tests remain unchanged.
- [x] Android SegWit deletion lost foreground activity before confirmation; screenshot showed launcher, app-only logs did not establish crash cause. Added bounded emulator activity/event capture before teardown. No uncertain deletion retry.
- [ ] iOS SegWit deletion opened a received funding transaction instead of the requested sent transaction. Exact transaction identity assertion remains intact. Root cause is still unproven; inspect replacement artifacts if reproduced. Do not retry signing/broadcast/deletion blindly.
- [x] Replacement worktree local validation: focused driver 13/13; full unit 93 suites, 844 passed, 1 existing skipped; fresh isolated Knots/Fulcrum integration 3/3 (both formats plus server faults), teardown complete; full lint/typecheck passed (0 errors, 15 warnings); diff whitespace check passed. Initial integration invocation omitted the opt-in flag and skipped all 3; it is NOT counted. The subsequent explicitly enabled invocation passed all 3.
- [x] Retained validation logs: `/tmp/redwallet-followup-focused.log`, `/tmp/redwallet-followup-unit.log`, `/tmp/redwallet-followup-backend-enabled.log`, `/tmp/redwallet-followup-lint.log`; backend receipts under `artifacts/native-lifecycle/`. Failure evidence retained under `/tmp/redwallet-58c69-android-delete`, `/tmp/redwallet-58c69-ios-cpfp`, `/tmp/redwallet-58c69-ios-delete` and corresponding logs.
- [x] Committed and verified remote source `68d582693c56e65b97a507e0dc2570bbf3a75ca3`. Current focused [Android 37659597434](https://github.com/romanmodin/RedWallet/actions/runs/37659597434) and [iOS 37659597400](https://github.com/romanmodin/RedWallet/actions/runs/37659597400) are in progress. Two earlier push-triggered runs on this same SHA are cancelled (Android 37659596764, iOS 37659596838); no manual duplicate dispatch or cancellation performed. Older-source passes do not qualify the replacement. This post-push documentation receipt is intentionally uncommitted while healthy workflows run, to avoid another source change.
- [ ] After all seven independently reset stages for both formats/platforms and software gate pass on the replacement, check for existing final runs and dispatch gated continuous workflows on that same source. No final dispatched in this follow-up; continuous native acceptance remains unverified. Hosted tests do not establish physical-phone or cold-device interoperability. PR40 and publication remain separate.


## Viewport, readiness and teardown follow-up — October 7, 2026

- [x] Inspected completed source `68d582693c56e65b97a507e0dc2570bbf3a75ca3`: [Android 37659597434](https://github.com/romanmodin/RedWallet/actions/runs/37659597434) and [iOS 37659597400](https://github.com/romanmodin/RedWallet/actions/runs/37659597400). Software and both builds passed. Android recovery/receive/send passed; RBF/encryption/CPFP/delete failed. iOS recovery/send/CPFP/encryption/delete passed; receive/RBF failed. Older-source passes cannot qualify the replacement.
- [x] Android deletion evidence now proves the 500-point scroll intercepted Taskbar at 18:07:02 UTC, brought Quickstep to front and paused RedWallet before confirmation. Use a shorter scroll starting at the content center; retain both actual deletion confirmations and recovery assertions. No foreground relaunch or uncertain confirmation retry.
- [x] Android SegWit RBF failed before the original broadcast: Back returned 2ms before the immediate broadcast tap found no control. Require the review screen's broadcast button after Back, then tap once. All reviewed-hex, signature, recipient, amount and mempool assertions remain.
- [x] iOS receive failure screenshot shows the wallet screen with Send present after the two 3-second waits. Use the transaction-list destination as the navigation sentinel, then separately require Send with the existing standard readiness helper, instead of retapping the old home card while wallet actions load.
- [x] iOS SegWit RBF retained a successful native receipt and backend cleanup receipt, but the trace completed the scenario near the 600-second Jest deadline and timed out during simulator shutdown. Give this lifecycle file a bounded 60-second teardown allowance (660 seconds total); individual action deadlines remain. This does not convert its failed job into a pass.
- [x] iOS Taproot RBF screenshot remains on the fee form with Custom 4 and Create; backend receipt has no unanswered methods and only the original broadcast. Root cause is not proven. Add a real keyboard-absence wait after Done and start fee-form scrolling inside the viewport before the single Create tap. Do not retry Create or broadcast; replacement native evidence is required.
- [x] Android CPFP produced both native success receipts but its job failed recording video/log files; encryption never reached native assertions because emulator SDK installation reported an invalid ZIP and adb connection refused. These are infrastructure failures, not accepted passes or demonstrated app defects. Requalify in fresh hosted jobs.
- [x] Local final validation passed: 18 focused driver regressions in 3 suites; full lint/typecheck 0 errors and 15 existing warnings; diff whitespace check clean. Logs: `/tmp/redwallet-68d-followup-focused.log`, `/tmp/redwallet-68d-followup-lint.log`. No assertions removed or weakened.
- [x] Evidence retained under `/tmp/redwallet-68d-artifacts`, `/tmp/redwallet-68d-ios-partial`, `/tmp/redwallet-68d-ios-critical`; failed iOS job logs `/tmp/redwallet-68d-ios-job-112927608823.log` and `/tmp/redwallet-68d-ios-job-112927608839.log`.
- [ ] Verify replacement pushed source and fresh software/backend plus seven independently reset stages for both formats/platforms. Only after all exact-source prerequisites pass, check for existing final runs and dispatch the gated continuous workflows. No final continuous acceptance, physical-phone/cold-device interoperability or PR40 publication is claimed.

- [x] Replacement pushed and local/remote verified at 2026-10-07 12:28 PDT: `2c32d2f9f9d06cf6e9f231abae8fe18ff3b6ff07`. Worktree was clean immediately after push. Fresh automatic push runs [Android 37674737361](https://github.com/romanmodin/RedWallet/actions/runs/37674737361) and [iOS 37674737343](https://github.com/romanmodin/RedWallet/actions/runs/37674737343) are in progress on that exact SHA. No duplicate dispatch, cancellation or final run. This post-push status receipt is intentionally uncommitted while healthy jobs run; preserve it.


## Exact-source 2c32 focused results and prepared bounded corrections — 2026-10-07 13:28 PDT

- [x] [Android 37674737361](https://github.com/romanmodin/RedWallet/actions/runs/37674737361) completed successfully on exact source `2c32d2f9f9d06cf6e9f231abae8fe18ff3b6ff07`: software/backend, build, and all seven independently reset recovery/receive/send/RBF/CPFP/encryption/delete stages passed both formats.
- [x] [iOS 37674737343](https://github.com/romanmodin/RedWallet/actions/runs/37674737343) build and recovery passed. At this receipt, receive and send are still running; delete and RBF are queued. CPFP and encryption failed. Preserve all healthy jobs; no duplicate dispatch or cancellation.
- [x] Retained CPFP evidence proves SegWit stopped in backend setup before app execution: the cold Knots child produced an empty log inside the 30-second readiness cutoff, while the same job's warmed Taproot launch needed 18 seconds before RPC and then passed the complete native CPFP stage. Increase only the read-only Knots readiness poll to a bounded 120 seconds. Do not retry any signing, mining, broadcast, deletion, or other mutating action.
- [x] Retained iOS encryption screenshots and Detox hierarchy prove both formats reached the secured Security screen with Plausible Deniability visible, while iOS kept a dismissed secure text field in its accessibility hierarchy. Require the real secured destination on iOS; retain both secure-field dismissal and destination assertions on Android.
- [x] Local prepared correction passes 6 focused driver tests in 2 suites, full lint/typecheck with 0 errors and 15 existing warnings, and `git diff --check`. The correction is not yet committed or pushed while healthy iOS source-2c32 jobs continue.
- [ ] When the current iOS jobs finish, inspect every remaining result and retained receipt, incorporate only evidence-backed changes, then commit/push one replacement source and rerun the requisite Android/iOS focused workflows on that exact source. Older-source passes will not qualify it.
- [ ] Dispatch no final continuous workflow until software/backend and all seven focused stages pass both formats on both platforms on one exact source. No complete continuous native lifecycle, physical-phone/cold-device interoperability, PR40 qualification, or publication is claimed.


### Progress receipt — 2026-10-07 14:15 PDT

- [x] Exact source remains `2c32d2f9f9d06cf6e9f231abae8fe18ff3b6ff07`; the prepared CPFP/encryption driver corrections remain local and uncommitted while healthy source-2c32 iOS work runs.
- [x] [iOS 37674737343](https://github.com/romanmodin/RedWallet/actions/runs/37674737343) recovery and receive now pass both formats. Send and RBF are actively executing their native stage; delete remains queued. CPFP and encryption retain the already-diagnosed failures. No duplicate run, cancellation, or replacement push.
- [ ] Await send/RBF/delete completion and retain their evidence. Then make any additional evidence-backed correction, run focused regression plus full lint/typecheck, commit/push one replacement source, and requalify requisite Android/iOS workflows on that exact source.


## Completed source-2c32 iOS evidence and replacement qualification — 2026-10-07 15:27 PDT

- [x] Completed [iOS 37674737343](https://github.com/romanmodin/RedWallet/actions/runs/37674737343) on exact source `2c32d2f9f9d06cf6e9f231abae8fe18ff3b6ff07`: build, recovery, receive and delete passed. Send, RBF, CPFP and encryption failed. [Android 37674737361](https://github.com/romanmodin/RedWallet/actions/runs/37674737361) remains fully green for software/backend, build and all seven stages on that predecessor source.
- [x] Retained Send evidence proves SegWit completed the real native send and broadcast with backend cleanup. Taproot exhausted the 660-second Jest ceiling while entering the shared bounded recovery wait; it did not reach a Taproot send assertion.
- [x] Retained RBF evidence proves Taproot completed the real native replacement broadcast with backend cleanup. SegWit exhausted the same 660-second ceiling while entering the shared recovery wait; it did not reach a SegWit RBF assertion.
- [x] Raise only the per-case Jest outer ceiling to 900 seconds, within the workflow's existing 40-minute native-stage limit. Preserve the recovery wait's 90-second bound, all stage action bounds, and every wallet/backend acceptance assertion. No signing, broadcast, deletion or other uncertain action is retried.
- [x] Preserve the prepared evidence-based CPFP cold-start readiness and iOS encryption destination corrections. Focused driver regression: 6/6 tests in 2 suites pass. Full lint/typecheck passes with 0 errors and 15 existing warnings. `git diff --check` passes. Logs: `/tmp/redwallet-2c32-final-lint.log`; source-2c32 send/RBF evidence under `/tmp/redwallet-2c32-ios-send-critical` and `/tmp/redwallet-2c32-ios-rbf-critical`.
- [ ] Commit and push one replacement source, verify local/remote identity, and allow the automatic focused Android/iOS workflows to requalify the new exact source. Do not count source-2c32 passes for replacement qualification.
- [ ] Only after software/backend and all seven focused stages pass both formats/platforms on the replacement source, check for existing final runs and dispatch the gated continuous workflows. No complete continuous lifecycle, physical-phone/cold-device interoperability, PR40 qualification, or publication is claimed.


- [x] Replacement committed/pushed and local/remote verified at 2026-10-07 15:27 PDT: `6145d6ce3b31a3375fb7731d00d940551fbc889c`. Worktree was clean immediately after push.
- [x] Exactly one fresh automatic [Android 37696154888](https://github.com/romanmodin/RedWallet/actions/runs/37696154888) and [iOS 37696155262](https://github.com/romanmodin/RedWallet/actions/runs/37696155262) workflow are in progress on the exact replacement SHA. Android software/build and iOS build are active; focused stages have not started. No duplicate dispatch, cancellation or final run.
- [ ] Preserve the healthy workflows and this intentionally uncommitted post-push receipt. Verify the exact-source software gate and all seven focused stages before any gated final dispatch.


## Exact-source 6145 focused progress and Android artifact readiness — 2026-10-07 16:21 PDT

- [x] [Android 37696154888](https://github.com/romanmodin/RedWallet/actions/runs/37696154888) exact-source software/backend, build, recovery, receive, send, RBF, CPFP and delete passed. Encryption failed only because the cold emulator could not open Detox log/video files under `/sdcard`; Taproot then started on the warmed emulator and passed the real encryption lifecycle. Six of seven Android stages are accepted on source `6145d6ce3b31a3375fb7731d00d940551fbc889c`; encryption is not.
- [x] Retained Android failure log proves `Operation not permitted` for Detox's direct `/sdcard` log/video paths before the SegWit app test began. This is an emulator artifact-recorder readiness fault, not evidence of an encryption defect.
- [x] Prepared a bounded Android runner correction that proves the exact Detox logcat and screenrecord operations are writable, retrying at most 30 times at two-second intervals before starting the test. It does not extend, skip or weaken any wallet lifecycle assertion.
- [x] Local verification passes: shell syntax, two artifact-readiness regressions, two encryption completion regressions, affected-file ESLint, full lint/typecheck with zero errors, and diff whitespace check.
- [x] [iOS 37696155262](https://github.com/romanmodin/RedWallet/actions/runs/37696155262) exact-source build, receive, CPFP and encryption have passed. Recovery and send are still running; delete and RBF are queued. The CPFP and encryption corrections are therefore hosted-verified on iOS.
- [ ] Preserve the active iOS jobs and do not push the prepared Android correction until they finish. Inspect any remaining failure evidence, then commit/push one replacement source and requalify requisite exact-source workflows.
- [ ] Dispatch no final continuous lifecycle until software/backend and all seven focused stages pass both formats/platforms on the same source. Hosted simulator/emulator evidence does not establish physical-phone or cold-device interoperability; PR40 qualification and publication remain separate.


### Progress receipt — 2026-10-07 17:16 PDT

- [x] [iOS 37696155262](https://github.com/romanmodin/RedWallet/actions/runs/37696155262) now has exact-source build plus receive, send, CPFP, encryption, recovery and RBF success. The prior CPFP, encryption, send and RBF corrections are hosted-verified. Deletion is the only iOS stage still running.
- [x] [Android 37696154888](https://github.com/romanmodin/RedWallet/actions/runs/37696154888) remains exact-source software/build plus six of seven focused stages successful; encryption retains the diagnosed cold-emulator artifact-recorder failure.
- [ ] Preserve the active iOS deletion job. When it completes, inspect its receipt, run final local checks, commit/push the prepared Android artifact-readiness correction (plus only any newly evidenced fix), and requalify the replacement source. No final continuous workflow is eligible yet.


## Completed iOS qualification and Android recorder correction — 2026-10-07 17:25 PDT

- [x] All source-`6145d6ce3b31a3375fb7731d00d940551fbc889c` jobs finished before replacement. [iOS 37696155262](https://github.com/romanmodin/RedWallet/actions/runs/37696155262) build and all seven independently reset stages passed both formats. Retained deletion native receipts match the source and set deletionRecoveryPassed=true for SegWit/Taproot; both backend cleanupComplete receipts are true.
- [x] [Android 37696154888](https://github.com/romanmodin/RedWallet/actions/runs/37696154888) software/backend, build and six stages passed. SegWit encryption failed in the cold emulator's log/video recording initialization before wallet execution; Taproot encryption then passed. Retained log: `/tmp/redwallet-6145-android-encryption.log`. iOS deletion evidence: `/tmp/redwallet-6145-ios-delete-evidence`.
- [x] Android preflight now exercises the exact logcat/screenrecord operations and verifies both probe files before starting Detox once. It permits at most 30 readiness probes and bounds every adb call to five seconds with a one-second forced-stop grace. Persistent readiness failure exits before wallet execution. No uncertain wallet action is retried.
- [x] Replaced source-text checks with four behavioral regressions: successful readiness and Detox exit propagation, transient log failure, persistent log failure and persistent video failure. Together with encryption completion regression, 6/6 tests in two suites pass. Shell syntax, full lint/typecheck (exit 0, zero errors, 15 existing warnings), and diff check pass. Logs: `/tmp/redwallet-artifact-focused.log`, `/tmp/redwallet-artifact-lint.log`.
- [ ] Commit/push this bounded correction and requalify software/backend and all seven focused stages on both platforms on the replacement source. Predecessor passes do not qualify that source.
- [ ] Final continuous native lifecycle remains gated until all exact-source prerequisites pass. Hosted simulator/emulator results do not establish physical-phone or cold-device interoperability. PR40 and publication remain separate.


- [x] Replacement committed/pushed and local/remote verified at 2026-10-07 17:26 PDT: `d2b7701c35c2dfafcc0d0b017164bc70c835ab6f`. Worktree clean after push.
- [x] Exactly one automatic push workflow per platform confirmed queued on this SHA: [Android 37707757274](https://github.com/romanmodin/RedWallet/actions/runs/37707757274), [iOS 37707757312](https://github.com/romanmodin/RedWallet/actions/runs/37707757312). No manual duplicate or final dispatch.
- [ ] Preserve healthy jobs and this post-push documentation receipt, intentionally uncommitted to avoid changing the source under qualification. Inspect the new software/backend and seven focused stages before deciding on final acceptance dispatch.


### Exact-source progress — 2026-10-07 18:17 PDT

- [x] Local and live remote remain `d2b7701c35c2dfafcc0d0b017164bc70c835ab6f`; only the intentional post-push agenda receipt is dirty.
- [x] [Android 37707757274](https://github.com/romanmodin/RedWallet/actions/runs/37707757274) completed successfully: build, software/backend, and all seven focused stages passed both formats. Software log verifies 95 unit suites / 850 passed / one existing skipped, lint/typecheck zero errors with 15 existing warnings, and three real isolated Fulcrum/Knots software tests passed.
- [x] Android encryption's recording preflight passed on attempt 1; SegWit and Taproot native encryption tests both passed. Retained native receipts match the exact source and encryptedHistoryPreserved=true; both backend cleanupComplete=true. Logs `/tmp/redwallet-d2b-android-encryption.log`, `/tmp/redwallet-d2b-software.log`; receipts `/tmp/redwallet-d2b-android-encryption-evidence`.
- [x] [iOS 37707757312](https://github.com/romanmodin/RedWallet/actions/runs/37707757312) build and encryption passed on this source. Recovery and CPFP are executing native stages; receive, send, RBF and delete remain queued. No failed job observed in this replacement qualification.
- [ ] Preserve healthy iOS jobs. If all seven stages pass, check existing final runs and dispatch both gated continuous workflows on this same source. Do not change source or create duplicates while these healthy jobs run.
- [ ] Complete uninterrupted native app-to-Fulcrum-to-Knots acceptance is still unverified. Hosted stages/software-backend acceptance do not establish physical-phone or cold-device interoperability. PR40 release qualification remains separate.


## iOS CPFP timeout isolation correction prepared — 2026-10-07 19:03 PDT

- [x] Live local/remote source remains `d2b7701c35c2dfafcc0d0b017164bc70c835ab6f` on `test/native-live-lifecycle-20261005`. The intentionally dirty post-push agenda has been preserved; the new correction below is local and uncommitted.
- [x] [Android 37707757274](https://github.com/romanmodin/RedWallet/actions/runs/37707757274) remains fully passed: exact-source software/backend, build and all seven focused stages, both formats. [iOS 37707757312](https://github.com/romanmodin/RedWallet/actions/runs/37707757312) build, recovery, receive, send and encryption passed. CPFP failed both cases at Jest's 900000ms deadline. RBF and deletion are healthy and preparing their isolated backends at this verification.
- [x] Retained CPFP evidence proves test-case overlap: SegWit timed out at 01:01:31 UTC, Taproot began then, but the SegWit native receipt was not written until 01:09:00 UTC and its backend cleanup until 01:09:02. Taproot then timed out at 01:16:36. No Taproot backend receipt was present. Failed workflow results cannot be accepted from these late receipts.
- [x] SegWit's timeout screenshot shows the simulator home screen, not RedWallet. Its last setup log was "launching native app", which preceded both clearKeychain and launchApp, so the exact slow operation is not proven. A 1.1GB system device log and the sampled apsd/trustd flood suggest simulator/driver trouble but do not establish its root cause or an app CPFP defect.
- [x] Prepared `.github/scripts/run-native-ios-stage.py`: each stage executes SegWit then Taproot exactly once in separate process groups; cleans the preceding group including backend children before the next format; preserves failure if either case fails. A new 18-minute process ceiling bounds CLI startup/teardown around the existing 15-minute Jest case limit, within the unchanged 40-minute workflow step. No wallet action is retried and no acceptance assertion or action deadline is weakened.
- [x] The iOS workflow invokes the paired runner; `tests/native/lifecycle-formats.ts` selects one requested format and rejects invalid values while preserving both formats by default for Android. The native test records elapsed phase markers for keychain reset, app launch, configuration, recovery, each wallet action and cleanup. Seven stage names and gated final prerequisites are unchanged.
- [x] Local validation: 11 focused Jest tests in two suites passed, including three behavioral subprocess scenarios (both formats once, exited-parent orphan cleanup, timed-out group cleanup). Full lint/typecheck passed with zero errors and 15 existing warnings; diff whitespace check passed. Logs: `/tmp/redwallet-ios-isolation-exact-focused.log`, `/tmp/redwallet-ios-isolation-python.log`, `/tmp/redwallet-ios-isolation-lint.log`. An initially overbroad local npm unit invocation was stopped; only the retained focused completion is claimed.
- [x] Failure log: `/tmp/redwallet-d2b-ios-cpfp.log`; selective native/backend receipts: `/tmp/redwallet-d2b-ios-cpfp-evidence`; fully verified timeout screenshot: `/tmp/redwallet-d2b-ios-cpfp-timeout-screenshot`. Avoid the incomplete PNG previously left in the receipts directory and the partial ZIP. The screenshot directory contains the completed, CRC-verified image.
- [ ] Preserve current iOS RBF/deletion work. Once both finish, inspect their results/evidence, incorporate only any new evidence-backed correction, commit/push the prepared isolated change and requalify software plus all seven focused stages on both platforms on the replacement SHA. Do not push during healthy current jobs or create duplicate runs.
- [ ] Final continuous native app-to-real Fulcrum-to-Knots workflows remain ineligible. Do not count previous-source passes toward replacement qualification. Hosted stages do not establish physical-phone or cold-device interoperability. PR40 release qualification/publication remains separate.


### Progress receipt — 2026-10-07 19:15 PDT

- [x] Local HEAD and live remote still match `d2b7701c35c2dfafcc0d0b017164bc70c835ab6f`; prepared iOS isolation changes and earlier agenda receipts remain uncommitted and preserved. Diff whitespace check passes. Retained focused (11 tests), Python isolation and full lint/typecheck exit receipts remain zero; no unnecessary rerun.
- [x] [iOS 37707757312](https://github.com/romanmodin/RedWallet/actions/runs/37707757312) RBF and deletion have progressed from backend preparation into their actual native stages. Four focused stages remain successful; CPFP retains its diagnosed timeout/overlap failure. [Android 37707757274](https://github.com/romanmodin/RedWallet/actions/runs/37707757274) remains completed successfully on the same exact source.
- [ ] Preserve the two healthy iOS native jobs. After completion, inspect remaining evidence, commit/push the prepared correction and requalify the replacement source. No duplicate dispatch, cancellation, replacement push or gated final run performed during this check. Continuous native lifecycle acceptance remains unverified.


## Completed source-d2b iOS evidence and isolated-format replacement — 2026-10-07 20:24 PDT

- [x] [iOS 37707757312](https://github.com/romanmodin/RedWallet/actions/runs/37707757312) completed on source `d2b7701c35c2dfafcc0d0b017164bc70c835ab6f`: build, recovery, receive, send, RBF and encryption passed. CPFP and delete failed. RBF's success completes without a new defect. [Android 37707757274](https://github.com/romanmodin/RedWallet/actions/runs/37707757274) remains fully passed on this predecessor.
- [x] Deletion SegWit reached recovery discovery but exceeded 900000ms while waiting for the scan to finish. Its verified timeout screenshot shows Discovery at `Taproot · account 0 · change · 20`; no SegWit native/backend receipt exists. Taproot then passed the complete deletion/recovery stage in 455489ms; its exact-source native receipt sets `deletionRecoveryPassed=true` and backend receipt sets `cleanupComplete=true`.
- [x] The delete job repeated the cross-case hazard: Jest declared SegWit failed then immediately began Taproot while the timed-out SegWit async body/backend had no teardown receipt. The job later remained open until the 40-minute workflow limit. This reinforces the prepared process-group isolation correction; it does not establish a wallet deletion defect and the failed SegWit stage remains unaccepted.
- [x] Retained evidence: `/tmp/redwallet-d2b-ios-delete.log`, selective receipts `/tmp/redwallet-d2b-ios-delete-evidence`, manifest/extraction log `/tmp/redwallet-d2b-delete-artifact-extract.log`, and complete verified timeout screenshot `/tmp/redwallet-d2b-ios-delete-timeout-screenshot`.
- [ ] Commit and push the already validated isolation/timing correction, verify source identity, and allow its automatic Android/iOS focused qualification. Do not count source-d2b passes toward the replacement. No final workflow is eligible until the replacement's exact-source software and all seven stages pass both formats/platforms.


### Replacement pushed — 2026-10-07 20:23 PDT

- [x] Isolation/timing correction committed and pushed as exact source `a32dc5cbf47147c94c8d1930f6da810e9d1db2c7`; local and live remote identities match. Worktree was clean immediately after push.
- [x] Exactly one automatic [Android 37722462018](https://github.com/romanmodin/RedWallet/actions/runs/37722462018) and [iOS 37722462067](https://github.com/romanmodin/RedWallet/actions/runs/37722462067) focused workflow appeared on this exact SHA. Android is in progress and iOS queued. No duplicate/manual dispatch, cancellation or final run.
- [ ] Preserve these workflows and this intentionally uncommitted post-push receipt. Verify replacement software/backend plus all seven independently reset stages for both formats/platforms. Only after exact-source prerequisites pass, check for existing final workflows and dispatch the gated continuous runs.


### Replacement qualification progress — 2026-10-07 21:10 PDT

- [x] Local and live remote remain `a32dc5cbf47147c94c8d1930f6da810e9d1db2c7`. Only the intentional post-push agenda receipt is dirty; no pending implementation change.
- [x] [Android 37722462018](https://github.com/romanmodin/RedWallet/actions/runs/37722462018) completed successfully: software/backend, build and all seven focused stages passed both formats on this exact source. Software log verifies 96 unit suites / 857 passed / one existing skipped, full lint/typecheck zero errors and 15 existing warnings, plus all three isolated real Fulcrum/Knots integration tests passed. Retained `/tmp/redwallet-a32-software.log`.
- [x] [iOS 37722462067](https://github.com/romanmodin/RedWallet/actions/runs/37722462067) build, CPFP and encryption passed. CPFP log proves separate process execution: SegWit completed all phases in 472822ms and exited zero before Taproot began; Taproot completed in 390472ms and exited zero. Both native receipts match the exact source; both backend receipts have cleanupComplete=true and no unanswered methods. Retained `/tmp/redwallet-a32-ios-cpfp.log` and `/tmp/redwallet-a32-ios-cpfp-evidence`.
- [ ] iOS recovery is executing its native stage; receive is preparing its simulator; send, RBF and delete remain queued. No replacement failure observed. Preserve healthy jobs and do not duplicate runs or change source.
- [ ] After all five remaining iOS stages pass on this same source, check for existing final workflows and dispatch gated continuous Android/iOS acceptance. If any fails, inspect the new phase timing and retained evidence before correction. Software/backend and focused hosted passes remain distinct from uninterrupted native app-to-real Fulcrum-to-Knots final acceptance. Physical-phone/cold-device interoperability and PR40 publication are not established.


### Progress receipt — 2026-10-07 21:22 PDT

- [x] Local/remote source remains `a32dc5cbf47147c94c8d1930f6da810e9d1db2c7`; only intentional agenda receipts are dirty. [Android 37722462018](https://github.com/romanmodin/RedWallet/actions/runs/37722462018) remains successful for software/backend and all seven stages. Retained software log and both iOS CPFP backend receipts rechecked: exact source, cleanup complete, no unanswered methods.
- [x] [iOS 37722462067](https://github.com/romanmodin/RedWallet/actions/runs/37722462067) receive has advanced from simulator preparation into actual native testing. Recovery continues its native stage (started 21:07:01 PDT); send, RBF and delete are queued. Build, CPFP and encryption remain passed; no completed failure observed.
- [ ] Preserve healthy jobs. No source change, duplicate dispatch, cancellation or final run. All remaining exact-source iOS stages must pass before gated final continuous native acceptance; PR40 qualification and physical-device interoperability remain separate.


### Progress receipt — 2026-10-07 21:50 PDT

- [x] Local HEAD/live remote still a32dc5cbf47147c94c8d1930f6da810e9d1db2c7; only intentional agenda receipts dirty. Android 37722462018 remains successful for software/backend and all seven focused stages.
- [x] iOS 37722462067 now has five focused stages successful: recovery, receive, send, CPFP and encryption. Retained /tmp/redwallet-a32-ios-send.log verifies separate SegWit and Taproot tests both passed, with backend cleanup phase reached for each.
- [ ] iOS RBF executing native stage (started21:42:34 PDT); deletion preparing simulator (started21:48:07 PDT). No completed failure. https://github.com/romanmodin/RedWallet/actions/runs/37722462067
- [ ] Preserve healthy work. Final continuous workflows remain gated on both remaining stages; no duplicate dispatch, source correction or cancellation. Final uninterrupted native acceptance, physical-phone/cold-device interoperability and PR40 release publication are not established by these focused results.


### Deletion viewport correction — 2026-10-07 22:23 PDT

- [x] [iOS 37722462067](https://github.com/romanmodin/RedWallet/actions/runs/37722462067) completed with six focused stages successful: recovery, receive, send, RBF, CPFP and encryption. Deletion SegWit completed all phases in 587464ms, produced an exact-source native receipt with deletionRecoveryPassed=true and backend cleanup. Deletion Taproot failed before deletion while opening the exact sent transaction: the test required the full transaction-ID accessibility label to be visible, but the ID control can sit below the initial details viewport. Taproot backend cleanup completed with no unanswered methods; no Taproot native receipt exists and the stage remains failed.
- [x] Bounded harness correction: after selecting the exact TransactionRow by hash and reaching TransactionStatusScroll, openSentTransaction now waits for TransactionIdCopyButton, scrolls that exact control into view, then retains the full-hash accessibility-label assertion. No send, signing, broadcast or deletion action is retried; no timeout or acceptance assertion was weakened.
- [x] Local validation: transaction-status, iOS stage-runner and native lifecycle-driver tests passed (3 suites / 20 tests); full npm lint/typecheck passed with zero errors and the same 15 existing warnings; diff whitespace check passed. Logs: /tmp/redwallet-delete-scroll-focused.log and /tmp/redwallet-delete-scroll-full-lint.log.
- [ ] Commit and push the correction, then qualify all exact-source software/focused Android and iOS stages triggered for the replacement source. Final continuous workflows remain gated until every replacement prerequisite passes.
