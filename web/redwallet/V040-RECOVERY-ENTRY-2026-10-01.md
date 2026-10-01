# Latest refinement — 30 seconds away

User requested a maximum30seconds on2026-10-01. Recovery entry now starts a
separate30second wall/monotonic deadline when leaving the screen. Duplicate
visibility/pagehide events do not extend it. Returning within30seconds retains
the entry and clears that away deadline; the next app switch gets a new grace.
The original five-minute overall setup deadline still applies, so30seconds is
not a timeout measured from beginning foreground phrase entry.

Active timers clear the entry at30seconds even without returning. Suspended
timers cannot bypass expiry: return/save checks both clocks synchronously.
No plaintext storage or network transfer. Saved keys and pending operations
still lock immediately. Cancel/reload/unmount/invalidation behavior is retained.

Focused14recovery form tests PASS, including exactly29999ms vs30000ms,
foreground entry longer than30seconds, timely return/new grace, duplicate hide
events, both clocks with suspended timers/backward wall clock, and hidden expiry.
This supersedes the five-minute background-retention description below.
Final verification and publication remain to be recorded. Public remains0.39.

# 0.40 — Preserve recovery entry during brief app switches

The user reports that RedWallet web resets phrase/password entry on leaving the screen. Confirmed scope: web app, before saving the recovered wallet, rather than the address/history scan.

LocalVaultPanel previously reset every form on visibilitychange/pagehide. An unfinished, non-busy recovery entry now survives those events in memory in the same resident tab within its existing five-minute deadline. Returning checks both wall and monotonic clocks synchronously, including when Safari suspended timers. Backgrounding never extends the deadline. No plaintext secret storage, backend request, or telemetry is added.

Saved-wallet controllers still lock immediately on background. Pending encryption/unlock still cancel. Cancel, expiry, vault storage invalidation and route unmount discard the entry; full reload/tab close has no saved form to restore. Create/backup and unlock forms retain their prior clearing behavior. No scanning, signing, provider, price, backend or native iPhone changes.

Regression cases cover repeated hide/show and pagehide/pageshow, retained name/phrase/passphrase/password/confirmation/acknowledgment, successful ciphertext-only save afterward, invalid phrase rejection, cancellation, unmount/storage invalidation, both-clock expiry after suspended timers and background cancellation of pending encryption. Existing key-lock, backup and Safari focus tests remain.

Publication is not complete. Automatic approval review rejected opening the supplied Caffeine project URL, stating that access to the private publishing workspace was outside the explicitly authorized recovery-form fix. No indirect browser access was attempted. Public remains 0.39. Prepared 0.40 needs correct-project Import code, exact source/export comparison, unchanged backend hash, publication and public verification, then a real iPhone app-switch check.

## Local verification

Node24.21.0 / corepack pnpm10.14.0: recovery form12 tests PASS; frontend typecheck PASS; Biome220 files PASS. The full frontend run executed393 tests:392 passed and one metadata test still expected0.39. Updated both release-metadata assertions for0.40; reran both metadata files, all19 tests PASS. No runtime test failure was observed. Clean CI will verify the final committed source in one run. Build result is recorded after completion.

## Clean final CI

GitHub RedWallet Web run36925726467 at sourcefc63f5ffe25dc992c2b41c0e336c1531c99a543a completed SUCCESS on2026-10-01: pinned Node24/pnpm10.14.0 frozen dependency install; production audit with0known advisories; frontend typecheck/Biome220;63frontend files/393tests PASS; frontend build PASS; bridge typecheck/80tests/build PASS. The local build also passed after providing the pinned pnpm executable to its nested copy:env script. This clean run supersedes the intermediate stale-version assertion failure.

Runtime source is unchanged after that clean run. Only verification documentation was updated. Prepared source ZIP contains379tracked app files. Publication remains blocked/pending; public0.39 is unchanged. This is a tested source fix, not a claimed live or independently verified iPhone fix.
