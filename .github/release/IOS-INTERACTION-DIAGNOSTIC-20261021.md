# Isolated iOS interaction diagnostics

This branch is diagnostic only and must not be merged as release qualification. Candidate PR74 remains at 0e95d3b1205e3c4847556027512b97861baa948c. No application files change.

Current general run 39607685928 timed out after the portrait capture; landscape was not saved. Funded run 39607728697 last awaited a broad nested ScrollView downward swipe. Its retained failure PNG shows the empty home screen with pull-to-refresh spinner. These are observations, not proof of a wallet or signing defect.

The manual workflow builds a fresh simulator app, then independently checks direct vertical scrollTo(top) through empty recovery navigation and logs each artwork orientation command with a deadline. Rotation retains native bounds and original 15-second observation budget. Diagnostics omit full qualification and are explicitly nonqualifying. No funds, imports, signatures, joins, broadcasts, video, or automatic screenshots. Only manual empty-home/recovery/artwork screenshots are retained. Production release assertions and gates on PR74 are untouched.

Retained evidence SHA256: general 3d86cdc22ea32259675669da35d5c5388d948ca8338b96070418ad8fb2bb4fae; funded 5f7c58959975411058fe45669a8e33853d9d385de97b7cdd45cc178e384d041e.
