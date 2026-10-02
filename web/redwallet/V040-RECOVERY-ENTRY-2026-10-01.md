# Live lifecycle verification

On public0.40, a new explicitly disposable PUBLIC0.40TEST—NEVERFUND fixture
was saved encrypted and decrypted using only public dummy material. A real
built-in/home-bridge scan reached2addresses before an active reload; after reload
and unlocking the same wallet,3saved observations restored (one further response
completed before pagehide). Resume advanced to4. Home/Wallets navigation retained4
and locked keys. Explicit Reconnect retained4with a new actor; Resume advanced
to9addresses. Scan manually paused, keys left locked. Screenshot saved as
redwallet-040-resume-verified.jpg.
No real wallet credentials, balances or private storage were accessed; no broadcast.
This is Chromium verification; actual iPhone background suspension remains user test.

# Published combined 0.40 — 2026-10-01 PDT

Source f45efbac82ae87eed94bf02a54a8c7e6d50210a1 passed clean GitHub run36975503789:
64frontend files/401tests,80bridge tests, typechecks, Biome222, both builds,
frozen dependencies and production audit with0known vulnerabilities.

Caffeine Import code compiled revision43. Actual export contained all381reviewed
source files byte-for-byte. Compiled backend SHA256 remains
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001.
Explicitly authorized Push version update completed: Caffeine reports43live;
public Settings reload displays RedWallet0.40 and external analytics blocked.
Live fixture lifecycle verification PASS above; actual iPhone remains user check.
This supersedes pending/blocked statements below.

# Combined source validation

Local full frontend:64files/401tests PASS, TypeScript PASS, Biome222files PASS,
production Vite build/copy:env PASS. Scoped git diff check PASS. The build emitted
existing root-native tsconfig/Browserslist age warnings; no native files changed.
Clean GitHub CI and Caffeine exact source/import/export/publication still pending.

# Follow-up: durable interrupted recovery scans

User reports scan progress lost after switching away and supplies screenshots of
Direct Fulcrum connection closed and Account read timed out. Sign-in to Caffeine
is now restored, and publication authorization was explicitly granted. Earlier
blocked-publication statements below are historical. Public remains 0.39 pending
this combined release.

Each successful public history response checkpoints locally under the authenticated
account hash and XBT profile. Load bounds size/counts/fields and accepts only public
history rows; discovery uses cached entries only for addresses freshly derived from
the unlocked account. No key/phrase/password is persisted by this mechanism.
Incomplete scans survive reload and provider reconnect. The primary action resumes;
Restart is explicit. Changing gap/cap starts fresh. A completed scan replaces its
checkpoint only after successful durable snapshot saving. Storage failures are visible.
Background/pagehide pauses requests; return requires Resume. Closed/time-out errors
direct the user to Reconnect selected connection, then Resume. No automatic provider
fallback or payment replay added. Discovery completion is retained through balance
read failures so retry works. Cached addresses avoid both network calls and pacing.

Saved history is historical, including unused observations. Resume preserves the
scan start timestamp; Refresh/Restart checks new transfers to previously read
addresses. Display copy states this limitation. Every payment still needs fresh
coins, parent transactions, fees, checkpoint and change-address history checks.

A fixture regression deletes one encrypted wallet and checks another is byte-for-byte
unchanged, lists undamaged after catalog reload, and decrypts correctly. These tests
do not establish what happened to the user's own local data. Actual corruption has
not been demonstrated by the supplied screenshots.

Checks added: reload/new-actor resume after an overnight pause, no repeated history
or pacing for saved addresses, non-regressing count, preserved observation time,
balance-phase retry, pagehide pause, explicit restart, account isolation, malformed/
oversized/future/duplicate checkpoint rejection and storage refusal. Validation and
publication results will be recorded after they finish.

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
Final30second sourcea9b679065ec028d1284be103b9b9fd3732d0f7a4 passed clean
GitHub36928226353:395frontend tests/63files,80bridge tests, typechecks,
Biome220, both builds and production audit with0known advisories.
Local14focused/typecheck/lint/build also PASS. Publication remains pending;
public remains0.39. Runtime unchanged after CI; this update is documentation only.

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
