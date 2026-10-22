# Isolated iOS interaction diagnostics

This branch is diagnostic only and must not be merged as release qualification. Candidate PR74 remains at 0e95d3b1205e3c4847556027512b97861baa948c. No application files change.

Current general run 39607685928 timed out after the portrait capture; landscape was not saved. Funded run 39607728697 last awaited a broad nested ScrollView downward swipe. Its retained failure PNG shows the empty home screen with pull-to-refresh spinner. These are observations, not proof of a wallet or signing defect.

The manual workflow builds a fresh simulator app, then independently checks direct vertical scrollTo(top) through empty recovery navigation and logs each artwork orientation command with a deadline. Rotation retains native bounds and original 15-second observation budget. Diagnostics omit full qualification and are explicitly nonqualifying. No funds, imports, signatures, joins, broadcasts, video, or automatic screenshots. Only manual empty-home/recovery/artwork screenshots are retained. Production release assertions and gates on PR74 are untouched.

Retained evidence SHA256: general 3d86cdc22ea32259675669da35d5c5388d948ca8338b96070418ad8fb2bb4fae; funded 5f7c58959975411058fe45669a8e33853d9d385de97b7cdd45cc178e384d041e.

## Follow-up to diagnostic run 39637127457

The fresh simulator build passed. Both diagnostics failed. Scroll stopped before app launch: the diagnostic-only 30-second Keychain reset budget expired; the same operation completed at 32.7 seconds. Set a bounded 60-second reset budget and retain every navigation assertion. Rotation observed unchanged 402x874 UIKit bounds and byte-identical portrait/landscape screenshots. Native logs record both _UIOrientationRequestAction requests timing out; the final cleanup error is secondary to the failed observation. The log also shows SpringBoard restarting after the early Simulator attachment. Move attachment after all reset/launch operations to test that specific ordering hypothesis. Rotation assertions and 15-second settling budget remain unchanged. This is not yet a proven rotation fix.

Artifacts verified against GitHub SHA256: scroll 12366551623 / 9df5b8929660f858b8d73fa5d5312079e55043328c03ba83333563d2119f22c6; rotation 12366468701 / 8de5d554c22d1435aee9464048c9528203e2eb5d4b1a0164f158ceb0b9500293. Actual failed landscape PNG inspected: it is portrait, centered artwork and readable zero-balance wallet card. PNG hash 70304ddb6b13e5799c87864b7fd07bac322531d078873cdc5cd1cc6368fcd198.

Reuse only the successful same-branch manual simulator build from this run through the existing source verifier. Do not count this diagnostic toward release qualification.

## Follow-up to diagnostic run 39691385530

Rotation job 119538147860 passed. Its actual screenshots and JSON sidecars were inspected and hashes recomputed: portrait 402x874, landscape 874x402, return portrait 402x874. Return portrait shows centered artwork and readable zero-balance card. The landscape PNG remains a portrait framebuffer containing clipped landscape UIKit content, so this establishes native rotation, not complete landscape visual approval or release qualification.

Scroll job 119538148292 failed before any scroll action. Its 120-second launch wrapper expired at 23:21:45.269Z; Detox reported the app launched at 23:21:46.953Z. Logs show a fresh installation during Detox initialization followed by a redundant terminate/uninstall/install in the spec. Installed Detox 20.51.4 composeBehaviorConfig defaults reinstallApp to true, and this single-spec workflow does not pass --reuse. Remove only that duplicate reset by launching the already freshly installed app with newInstance:false. Keep the Keychain reset, notification permissions, original 120-second setup limit, all navigation assertions and 10-minute diagnostic step limit. No retries added. This remains a hypothesis until hosted evidence reaches and passes the scroll/recovery checks.

The workflow now permits selecting just scroll so the successful rotation diagnostic need not run again. Existing source-artifact verification is unchanged. No app code or release gate changes.

Verified artifacts: rotation 12389840616 / SHA256 65de69a34d8392bc7a8fa9caa43e68f612f3ae50bee40b6ea3dc86476346086e; scroll 12388399191 / SHA256 996945ada94c9f5971d756c17508385e7434b2384862c5e7463e8a1fe7ed0e87. Native capture hashes: portrait 60e541f343a5ca994fa7235ff2c360c518f94489772f12c8b34e059d142e1a5e; landscape efed4bbfa4d9ad405065cce8a7040c902683fb4a49c8f61ee5bb05cfea2fa0f9; return portrait 5cb67806aa75deef6408b10d54ca5c19894f7386b407b54955cb94480546153e.

## Final visual follow-up after source 286e qualified

All required source-286e software/general/funded iOS jobs passed. The actual general-run artifact 12400258528 (SHA256 a3201725adc561d691107e5a7c95e2228799c2088964e0fa21462d9f3dcbe7cf) was downloaded and all four PNGs reviewed. Portrait and pool discovery are readable. Landscape is correctly rotated inside portrait pixel coordinates, with small balance text. The immediate return-portrait capture does not show the wallet card. Do not infer either permanent disappearance or completed visual approval from that single frame.

This diagnostic uses the exact qualified scroll helper and unchanged production tree (989 paths, 8a9e96245cbc910bf5e30031728ac9345ff480787fa62158122108c53039b1fe). It preserves all immediate captures and adds a separate 15-second wallet-card visibility observation plus settled screenshot, without scroll/tap/relaunch recovery. Rotation deadlines and release assertions are unchanged. Reuse remains subject to the existing same-branch/source verifier. This is solely a visual-settling investigation, not replacement qualification.


## 2026-10-22: final visual follow-up did not reach the return-portrait check

Run 39744396216 failed during its first landscape transition, before the return-portrait wallet assertion. Artifact 12411038967 was downloaded and SHA256 verified as `25bc53ed832556aa2e79a4b9943c22c8d94d547dc04b1e49c257176eb0a7d6cc`. Both native orientation requests received `_UIOrientationRequestAction` timeout responses from SpringBoard; retained native bounds remained 402x874. At the original deadline an outstanding bounds request caused synchronization cleanup to report overlapping interactions. This is not evidence that the wallet failed to reappear after rotation: that step was never reached.

The nonqualifying diagnostic now opens an explicit Simulator instance for the selected disposable UDID through NSWorkspace, then requires an actual on-screen window belonging to the returned process before beginning orientation requests. Setup is bounded at 30 seconds and writes its own receipt. The native rotation assertions, original 15-second rotation budget, immediate captures and separate 15-second wallet-visibility check are unchanged. No app code or release gate is modified. This environment correction is unproven until hosted execution succeeds.
