# Isolated iOS interaction diagnostics

This branch is diagnostic only and must not be merged as release qualification. Candidate PR74 remains at 0e95d3b1205e3c4847556027512b97861baa948c. No application files change.

Current general run 39607685928 timed out after the portrait capture; landscape was not saved. Funded run 39607728697 last awaited a broad nested ScrollView downward swipe. Its retained failure PNG shows the empty home screen with pull-to-refresh spinner. These are observations, not proof of a wallet or signing defect.

The manual workflow builds a fresh simulator app, then independently checks direct vertical scrollTo(top) through empty recovery navigation and logs each artwork orientation command with a deadline. Rotation retains native bounds and original 15-second observation budget. Diagnostics omit full qualification and are explicitly nonqualifying. No funds, imports, signatures, joins, broadcasts, video, or automatic screenshots. Only manual empty-home/recovery/artwork screenshots are retained. Production release assertions and gates on PR74 are untouched.

Retained evidence SHA256: general 3d86cdc22ea32259675669da35d5c5388d948ca8338b96070418ad8fb2bb4fae; funded 5f7c58959975411058fe45669a8e33853d9d385de97b7cdd45cc178e384d041e.

## Follow-up to diagnostic run 39637127457

The fresh simulator build passed. Both diagnostics failed. Scroll stopped before app launch: the diagnostic-only 30-second Keychain reset budget expired; the same operation completed at 32.7 seconds. Set a bounded 60-second reset budget and retain every navigation assertion. Rotation observed unchanged 402x874 UIKit bounds and byte-identical portrait/landscape screenshots. Native logs record both _UIOrientationRequestAction requests timing out; the final cleanup error is secondary to the failed observation. The log also shows SpringBoard restarting after the early Simulator attachment. Move attachment after all reset/launch operations to test that specific ordering hypothesis. Rotation assertions and 15-second settling budget remain unchanged. This is not yet a proven rotation fix.

Artifacts verified against GitHub SHA256: scroll 12366551623 / 9df5b8929660f858b8d73fa5d5312079e55043328c03ba83333563d2119f22c6; rotation 12366468701 / 8de5d554c22d1435aee9464048c9528203e2eb5d4b1a0164f158ceb0b9500293. Actual failed landscape PNG inspected: it is portrait, centered artwork and readable zero-balance wallet card. PNG hash 70304ddb6b13e5799c87864b7fd07bac322531d078873cdc5cd1cc6368fcd198.

Reuse only the successful same-branch manual simulator build from this run through the existing source verifier. Do not count this diagnostic toward release qualification.
