# 0.40 scan resume follow-up — prepared, not yet published

Caffeine sign-in restored; user explicitly authorized publication. Prior automatic
approval/sign-in blocker below is superseded. Public remains 0.39 until verified.
New screenshots show direct Fulcrum closed/timeouts, not proof of vault corruption.
Partial public history checkpoints are now saved per authenticated account/profile
and restored across reload/reconnect. Resume is primary; explicit Restart discards
hints. Background/pagehide pauses. Completed discovery can retry balance aggregation.
Original scan observation time stays visible; cached history is historical and
fresh signing/coin/parent/fee/checkpoint checks remain mandatory. No secrets saved.
30-second recovery-entry grace retained. Removal fixture verifies another saved
vault remains byte-identical and unlocks after catalog reload; no removal corruption
reproduced. Native/backend/provider/security code unchanged. Local401frontend tests/64files, typecheck/Biome222/build PASS;
clean CI and exact import/export/backend hash/publication gates still required. See V040.

# 0.40 recovery-entry fix prepared — publication pending

User confirmed web wallet, phrase/password entry resets on leaving the screen.
LocalVaultPanel now retains only unfinished non-busy recovery entry in memory
across brief visibility/pagehide events for30seconds away, still capped by the
original five-minute setup deadline. Duplicate hide events cannot extend the
grace; a timely return resets it for the next switch. Both clocks are checked
on return and on save; active timers clear it at30seconds even before return.
User requested30seconds rather than5minutes. Focused14tests PASS. No plaintext storage or
network transfer. Keys/pending encryption/unlock still lock/cancel. Cancel,
expiry, vault invalidation and unmount clear entry; reload has no draft to restore.
Final30second sourcea9b679065/GitHub36928226353 PASS:395frontend/80bridge
tests, both builds/typechecks, Biome220 and production audit. See V040.
Automatic approval review rejected opening the private Caffeine project URL as
outside the explicitly authorized fix; no indirect UI access attempted. Public
remains0.39. Exact import/export/publish and actual iPhone switch check pending.
Native worktrees/backend/provider/signing/pricing unchanged.

# 0.39 published — wallet removal and corrected demo pricing

Caffeine42/public0.39 LIVE. Source b95792db4; clean GitHub36922369490 PASS:388frontend tests/63files, Biome220/typecheck/build/audit, bridge checks. All378source paths exactly match export; backend digest unchanged. Browser encrypted removal gates/cancel, individual demo removal/reload, hide-all/reload/empty dashboard/restore PASS. Both fixture vaults preserved. All visible demo fiat amounts now use configured NeoxEX/manual XBT quote, no BTC-sized sample rate; live USDC/Stale labels verified. See V039. This supersedes pending/sign-in notes below. Native iPhone untouched.

# 0.39 ready; publication blocked by sign-in

Source b8fd08687 pushed. Clean GitHub CI36921093626 PASS across frontend/bridge tests, checks, builds and audit.377file source ZIP ready. Caffeine signed out; Google passkey challenge failed. Stop automated auth; user handoff required before import/publish. Public remains0.38. See V039.

# 0.39 wallet removal prepared

User authorized individual test/demo wallet removal. Backup/name-gated encrypted deletion locks keys and preserves other vaults plus public indexes. Watch removal and persistent demo hide/restore added; empty dashboard handled. See V039. Publication pending.

# 0.38 live lifecycle follow-up PASS

Public fixture only. Encryption/signing self-test, wrong-password rejection,
unlock, navigation lock and encrypted-vault reload PASS. Live home bridge
scan pause/resume completed50addresses/block975058; zero balance,22history
entries. Reload/reunlock restores completed scan/history without rescanning;
history pagination PASS. Fixture locked; no broadcast. Latest GitHub run
36912821013 PASS. Verification-only docs, runtime unchanged. See V038.

# 0.38 published — production dependency security cleanup

Audit found9production advisories (1critical/3high/4moderate/1low). Removed
unused Quill/react-use/3D template packages; pinned seroval1.5.3/lodash4.18.0
via scoped web workspace overrides. Frozen install and fresh production audit
PASS:0known advisories,200dependencies vs301. Crypto and direct router versions
unchanged;0.37Safari focus fix retained. Added production audit to separate web
CI. Clean GitHub run36910218269 passed every step: frontend382tests,
bridge80tests, both typechecks/builds and audit. Caffeine40/public0.38 LIVE;
all376reviewed paths match actual export, backend digest unchanged.
Public0.38 and analytics protection verified.
No exploit demonstrated; audit count is not proof of runtime exposure. See V038.

# Release documentation and web CI follow-up

0.37 runtime remains unchanged and user-confirmed. Main README and foundation
notes now point to RELEASE-STATUS rather than obsolete v7 watch-only posture.
Separate .github/workflows/redwallet-web.yml runs pinned Node24/pnpm10.14.0
frontend and bridge checks on web pushes/PRs, read-only permissions/no secrets.
Native workflows untouched. YAML/scope/doc links PASS. First GitHub run
36907379969 passed every step: frontend382/bridge80tests, clean locked
install, typecheck/lint/build. Verified source e93b52f01. Documentation-only
follow-up; no Caffeine publication required.
See RELEASE-STATUS. Prior382frontend tests remain current.

# 0.37 final regression passed

User confirmed iPhone Keychain zoom resolved at2026-10-01 11:12PDT.
Final full frontend63files/382tests PASS; typecheck/Biome219 PASS. Initial
full run found one existing snapshot callback timing race in a test; wait for
restored observation and enabled Refresh fixes test without weakening it.
Product runtime unchanged, no new publication/version required. Public0.37
reloaded/protection blocked/home Test connection connected. See V037-FINAL
report and V037 zoom report; supersedes pending phone notes below.

# 0.37 published — iPhone Keychain zoom fix confirmed

Caffeine39/public0.37 LIVE. All373reviewed source paths exactly match export;
backend Wasm unchanged.31focused/typecheck/Biome219/build PASS. Public
release/protection plus disposable fixture unlock/focus release/no overflow
PASS in Chromium. On2026-10-01 at11:12PDT, user confirmed0.37 resolves
the reported automatic Keychain zoom issue. Earlier0.35/0.36 attempts failed.
This supersedes pending Safari confirmation notes below. See V037.

# 0.37 prepared — prevent Safari password focus zoom

User confirms0.36 post-unlock zoom reset failed. Replace it with Safari-only
maximum-scale1 while unlock form is mounted, installed in layout effect before
field focus. Restore exact original viewport on success/cancel/unmount. No
initial/minimum-scale changes; existing manual scale preserved, Safari permits
manual pinch. Other browsers/embedded webviews unchanged.31focused tests,
typecheck/Biome219/build PASS. Publish and actual iPhone Keychain check pending.
See V037 report. Supersedes0.36 zoom claims.

# 0.36 published — Safari Keychain zoom recovery

Caffeine38/public0.36 LIVE. All372source paths match actual export, backend
unchanged.29focused/typecheck/Biome219/build PASS. Live disposable fixture
unlock/focus release/no overflow PASS. iPhone Keychain zoom result remains
user check; temporary viewport reset is a candidate fix, not proven on Safari.
No persistent pinch restriction. See V036 report; supersedes pending notes.

# 0.36 prepared — Safari Keychain zoom recovery

User reports0.35 still zooms after Keychain autofill; manual pinch out restores
layout. Explicitly blur unlock password before disabling; successful unlock
requests normal viewport scale for350ms only on zoomed iPhone/iPad/iPod Safari.
Restore original viewport, leave other browsers and unzoomed Safari unchanged.
29focused tests/typecheck/Biome219/build PASS. Caffeine publication pending;
actual Safari Keychain cannot be reproduced in cloud Chromium, phone check required.
See V036 report. This supersedes0.35 pending phone notes.

# 0.35 published — touch control sizing

Caffeine37/public0.35 LIVE; all369 paths exactly match reviewed export and
backend Wasm unchanged. Public home bridge connected/0.35/analytics blocked.
Touch sizing CSS present; empty create text/password fields16px, no horizontal
overflow at500px desktop viewport; cancelled without wallet generation.
Typecheck/Biome217/build/22focused PASS. Actual iPhone zoom still requires user
check; do not claim Safari fixed from Chromium. Supersedes pending notes below.
See V035 report.

# 0.35 prepared — iPhone control text sizing

User verified0.34 phone provider switching/history retention. Reports slight
zoom after lock/unlock/navigation. Touch controls now at least16CSSpx across
breakpoints; text-size-adjust100%; normal pinch/page zoom preserved. CSS only
plus release metadata. Typecheck/Biome217/build/metadata-CSP-display22 PASS.
Caffeine exact import/export/hash/publish pending; iPhone final check required.
See V035-IPHONE-TEXT-SIZING-2026-10-01.md.

# 0.34 published — home primary, mempool.guide WSS backup

Caffeine36/public0.34 LIVE. All368 source files exactly match compiled export;
backend Wasm unchanged (6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001).
Public Settings0.34/home HTTPS bridge connected/built-in selected/backup privacy
and no-payment-retry copy verified. Analytics blocked. Routing/display28 and
full frontend374 passed as recorded; final source375 cases. Actual router with
simulated primary outage reached live mempool.guide; production home stayed
online. Direct-home no fallback and custom public opt-in preserved. This
supersedes pending-publication notes below. See V034 report.

# 0.34 prepared — home primary, mempool.guide WSS backup

User authorized mempool.guide backup with home Umbrel primary. Source routes
fixed registered WSS through existing worker, labels active backup and IP/privacy,
preserves direct-home no-fallback and custom public opt-in. Primary first,
checkpoint/time/6-block freshness gates, old actor/review invalidation,
retired/reused workers, no read replay or automatic broadcast retry.
Actual public browser worker Test975042 PASS; actual transport balance/history176/
UTXO/fee1011/raw223bytes PASS; malformed unsigned remote broadcast rejected.
Actual router with simulated primary outage uses live WSS correctly, exit0.
Full frontend374 PASS; final routing/display28 includes new375th privacy case.
Typecheck/Biome217/build PASS. Backend/native/bridge/CSP unchanged. Caffeine
sign-in blocks publication: public0.33 still live. Restore sign-in, import exact
reviewed source, compare actual export and unchanged backend digest, publish and
verify public0.34. See V034-MEMPOOL-BACKUP-2026-10-01.md.

# 0.33 automated release checks completed

All available automated lanes PASS: frontend61files/364tests, bridge80tests,
actual hash-matched compiled backend25PocketICtests on isolatedZorin; frontend
and bridge typecheck/build, Biome216. Current offline signer matches previously
node-tested XBT/Bitcoin fixtures exactly. PublicChrome self-test/recovery/wrong
password/reload/navigation lock/5minlock/WSSsave-reload/WSrejection PASS.
Live public test identity scanned82addresses at974957; pause/resume, switching
WSS to shared, reload/unlock and explicit reconnect preserve exact displayed
history/count/original observation without new scan. No funded submission or
user keys accessed. ActualiPhone remains user's test; cosmetic splash deferred.
Standalone Motoko contracts now PASS: native moc1.16.0/Mops3.4.1,
locked dependencies, exact source copies, all16tests including oversized
fixtures; repeatable command exit0. Total485cases. WASI exploratory compile
unsupported by implicit core async APIs, not counted as passing. Reproduction
src/backend/test/README.md. Independent backup operator steps prepared in
deploy/adapter/INDEPENDENT-BACKUP.md; no independent host found in saved notes.
BUILTIN_BACKUPS empty/no independent redundancy claimed. Verification only,
public remains0.33. See V033-AUTOMATED-RELEASE-CHECKS-2026-10-01.md.

# 0.33 published — inline welcome video

Caffeine35/public0.33 LIVE; all363 source paths exactly match actual export,
backend Wasm unchanged. Public Settings0.33/analytics blocked, NetworkConnected
at974954. Native controls removed, playsInline/muted autoplay retained, picture
in picture/remote playback disabled. Splash/metadata19tests/typecheck/Biome/build
PASS. iPhone playback remains user's check in a fresh private tab. No wallet,
backend/native/keys/CSP changes. See V033 report; prior pending note superseded.

# 0.33 prepared — splash stays in main page

Removed native video controls; retained playsInline/muted autoplay/Continue.
Picture-in-picture and remote playback disabled. Splash/metadata 19 tests,
typecheck/Biome/build PASS. Source publication pending Caffeine sign-in.
No wallet/backend/native/CSP changes. See V033 report; do not claim live.

#0.32 published — reconnect without mandatory recovery discovery

Caffeine34/public0.32 LIVE. All362 reviewed source files exact export matches;
actual compiled backend Wasm unchanged from25PocketIC-tested0.28. Public
Settings0.32/shared connected/analytics blocked; directWSS Test/Save/reload
connected at974937; return built-in checked. Completed historical scans remain
address hints after failed refresh. Explicit reconnect replaces stale actors,
invalidates reviews/late reads and restores saved scan/draft without discovery.
Fresh coins/raw parents/fees/pin/change still mandatory for payment preparation.
No automatic reconnect/fallback/signing/broadcast retry. Actual iPhone saved-vault
reconnect remains user's check. Native/backend/bridge/keys/CSP unchanged.
See V032 report; earlier sign-in/pending-publication notes are superseded.

#0.32 saved; Caffeine sign-in blocks publication

Source8a5b8d7f2 pushed GitHub/Zorin. Import code redirected to sign-in before
file chooser; sourceZIP not uploaded. Secure method request selected Google,
target login remained. Finish secure/manual cloud sign-in, import reviewed
362file0.32 archive, compare export/backend hash, publish and verify publicly.
0.31 is still live. See V032 report. Never claim prepared changes are live.

#0.32 prepared — explicit reconnect preserves completed discovery

User reports provider-change scan stuck before any address read. Completed scans
remain historical public hints after failed refresh; current coin/parent/fee/pin/
change checks remain mandatory. Explicit reconnect invalidates bound reads/reviews
and restores saved scan/draft without discovery. No automatic reconnect, fallback
or broadcast retry. Late WSS resolution cannot clear a replacement session.
Native/backend/bridge/keys/CSP unchanged. Exact Caffeine import/export/publish and
live verification pending; see V032-CONNECTION-SCAN-2026-09-30.md.

# 0.31 published — detailed own-canister guide in separate tab

Caffeine33/public0.31 LIVE. All361 uploaded source paths exact export matches;
built guide asset exact and backend Wasm unchanged from25PocketIC-tested0.28.
Public Settings guide click opened separate tab with full1796word/7section
static guide; original wallet tab stayed open/built-in connected. Desktop
layout verified; public analytics block still observed. No scripts/forms or
secret fields in guide. Typecheck/Biome/build and Settings/metadata10tests PASS.
No key access/funded broadcast/native/bridge/backend change. See V031 report.
This supersedes earlier guide-preparation and pending-publication notes.

# 0.30 published; 0.31 canister guide in preparation

Caffeine32/public0.30 LIVE, all359 source paths exact export match. Actual
backend Wasm identical to0.28 tested25PocketIC artifact. Chrome draft/public
WSS Test/Save/reload at974926 passed; shared default/return connected passed;
public analytics block observed. Production canister read/pin/fee probe PASS.
No key access/funded broadcast/native changes. See V030 report.
User requests detailed own-canister guide opening a separate browser tab.
0.31 adds same-origin static script-free help and a target=_blank/noopener link.
No provider/backend/key/CSP changes. Exact import/export/publish required.
This supersedes earlier0.30 pending-authentication notes below.

#0.30 source saved; publication blocked by Caffeine sign-in

Commit e31ab00f5 is on GitHub and Zorin. Exact359file archive accepted via Import
code; deployment in progress preceded sign-out. Secure sign-in not completed.
Do not duplicate import before checking its result.0.28 remains verified live;
0.30 compile/export/browser-WSS/publish are pending authentication. Actual Vite
worker ran live against home WSS and verified checkpoint/fees. No funded send
or key access. See V030-DIRECT-WEBSOCKET-2026-09-30.md for evidence and limits.

# Prepared0.30: shared relay default and direct home WSS

Preserves0.29 form fix and0.28 NeoxEX pricing. Direct secure WebSocket worker
routes every public wallet call without a personal adapter canister. No fallback
or retry in direct mode; keys/CSP/backend/native unchanged. Frontend362tests,
typecheck/build/Biome passed. Umbrel WS loopback55004 and /fulcrum-ws TLS10000
path enabled and public WSS handshake/checkpoint tested. Exact Caffeine import,
export comparison, publish and browser verification pending. See
V030-DIRECT-WEBSOCKET-2026-09-30.md.0.28 still production until verified publish.

# Prepared0.29: clear required HTTPS bridge URL field

Fixes reported empty URL showing home placeholder and raw Safari parse error.
Explicit entry prompt/required hint, draft-vs-active service guidance, fixed empty/
malformed messages and URL keyboard/no capitalization. No default URL substitution,
route/security/backend/pricing/native changes. See V029-NETWORK-FORM-2026-09-30.md.
Exact-source compile/export/publish/live verification pending;0.28 remains live.

# 0.28 additional verification: actual PocketIC gate passed

Published Caffeine30 Wasm SHA256
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001
was transferred with hash verification to an isolated Zorin cache. All25 tests
passed:14 existing API/auth/validation and11 real provider/pricing HTTPS response
cases. New manual workstation runner requires exact artifact hash, fails on test
failure/mismatch and stops its replica; platform sidecar runner remains unchanged.
Scratch PocketIC timeout was Unix socket PermissionDenied, not an application
failure. No live funded broadcast, production mutation or native worktree change.
See V028-INTEGRATION-2026-09-30.md. This supersedes the PocketIC-open notes below
for this tested0.28 artifact. Independent backup/Safari checks remain open;
full Motoko JS interpreter overflow is a separate unpassed pure-unit limitation.
App remains0.28:verification-only changes do not require publication.

# Current release: 0.28 pricing and isolated providers — published

Caffeine internal30 is LIVE at redwallet-7m3.caffeine.xyz. All329 reviewed paths
present in compiled export:326 exact matches and three expected regenerated
backend bindings, adopted/typechecked/tested/built. Backend7gylz-gyaaa-aaaab-qhjrq-cai
retains private operator configuration. Actual public canister metadata/read/fee/
raw/malformed-broadcast/NeoxEX checks passed at21:49:49Z, height974914, exactpin.
Live custom home adapter Test/Save/reload passed; mismatched entered host rejected
without shared mutation; returnbuilt-in/reload passed. Autoquote362.82USDC,
Manual350save/switch/reload passed; finalAuto. Existing encrypted disposablewallet
and269history entries/five outcome proofs restored from the original82addressscan
withoutrescan. No funded transaction submitted. Keys/CSP/native/migrations preserved.
No independent backup configured or tested: injected default-failover tests pass,
but no production redundancy is claimed. FullPocketIC gate remains open.
See V028-PRODUCTION-2026-09-30.md and deploy/adapter/README.md. This supersedes
older pending-publication sections below; no price-only29 was published.

# Current prepared release: 0.28 pricing and real provider selection

Preserves the pending NeoxEX Auto/Manual work; internal Caffeine29 was compiled
but never published. This combined source adds separate HTTPS/ICP adapter routing
for every live read and signed broadcast. Built-in is the default, using the home
Umbrel. Custom settings are per browser and never call shared operator setters.
An HTTPS bridge plus its separately configured adapter canister is required;
raw TCP hostname alone cannot work. Verify actual host/port/TLS/bridge identity,
pinned checkpoint and header-derived chain tip <=2h old before acceptance.
Custom failures never fall back unless the user explicitly enables the optional
built-in fallback; active fallback must be visibly identified. Built-in independent
backup registry is EMPTY: no production redundancy or live independent failover
is claimed. Runtime backup adoption also rejects tips >6 blocks behind last good.
Provider generation guards reject in-flight late results and invalidate one-shot
reviews synchronously. Public historical scans, wallets and signed receipts remain.
Never retry/rebuild a signed broadcast automatically. Unknown originals are queried
by txid before an explicit retry; unresolved lookup blocks dispatch, known exact
bytes return acknowledgment. Native worktrees, keys/signing/CSP/stable migration
chain/operator credentials remain untouched. No arbitrary HTTPS proxy was added.
Frontend60files/351tests,80bridge tests,typecheck/build/Biome211files passed.
Full backend compiled with zero diagnostics; new metadata pure Motoko test passed.
The JS interpreter overflowed on an existing >1000-entry test; do not claim full
Motoko runtime/PocketIC success. Caffeine exact import/export/publication pending.
See deploy/adapter/README.md and V028-PROVIDERS-2026-09-30.md. This section supersedes
the older pricing-only preparation scope below.

# Current release preparation: 0.28 Auto/Manual NeoxEX display price

User reports0.27 works well on the requested iPhone follow-up. This is user
feedback, not independent Safari instrumentation.0.28 adds Auto(NeoxEX) and
Manual modes. New devices defaultAuto; legacy valid manual quotes migrateManual
so existing preferences are preserved. Switching modes retains both quotes.
The fixedBTCB2_USDC latest-trade endpoint is accessed via a separate anonymous
bounded canister method, not a browser cross-origin request. No wallet data,
operator credentials or bridge secrets enter this price request. No CSP, bridge,
crypto, migration or financial submission changes. Exchange quote currency is
USDC, not an exactUSD conversion. Preserve execution time; show stale>=15min,
retainlastvalidquoteonfailure, cacheperdevice, poll5minforegroundonly, throttle
allcanisterpaidexchangecalls5min globally and300perUTCday(transient cache/caps).
Validateclientpair/finitepositiveprice<=1e12/tradeID/strictUTCtime/calendar/future
skew/bodybounds. Price is display-only; never use it in spending checks.
Caffeinecompile/export/publication/livepricevalidationpending; seeV028report.

# Current release: 0.27 verified in production

Caffeine internal revision28 is live, user-facing0.27. All317 uploaded source
files matched the compiled export exactly. Production Settings confirms0.27,
external analytics blocked and bridge Connected. Explicit history amount lookup
and raw-proof cache restore passed on the published disposable fixture across
Home/Activity/Wallets and full reload, retaining the original82-address scan.
Manual price save/rate/time/clear passed. Automatic market pricing remains
unimplemented. iPhone background/reopen validation remains a user check; no new
funded payment needed. See V027-PRODUCTION-2026-09-30.md for exact verified scope.
Earlier prepared0.27 authentication/import blocks below are superseded.

# Current release preparation: 0.27 transaction outcomes and manual price clarity

History may explicitly load bounded raw transaction/parent data through the
checkpoint-verified canister. Verify all raw IDs/prevouts, derive ownership from
this authenticated account's discovered/issued addresses, and exclude change
from sent amounts. Display fees separately. Mixed-input transactions show net
wallet change; do not assign their whole fee to the account. Persist bounded raw
proofs and recompute outcomes on restore. Neither proofs nor amounts authorize
spending. Preserve scan, signed receipts, drafts, keys and confirmation gates.
Home/Activity navigation itself does not trigger a scan or amount lookup.
Manual USD estimates must state source/update time and never imply a live quote.
The native NeoxEX BTCB2_USDC trade endpoint returned HTTP 500 during preparation;
no automatic feed or USDC/USD parity is claimed. No CSP/crypto/backend changes.

# Current release preparation: 0.26 local wallet tabs

Authenticated public account selection now survives same-tab navigation through
LocalAccountProvider; it contains only id/name/PublicXbtAccount, never controllers,
secrets, reviews or consent, and is not persisted. Full reload still requires
unlocking the same vault once. Home and Activity show validated saved observations
and signed receipts for that account instead of unrelated demo data. Send and
Receive reuse the exact existing CSP-gated workspace. Navigation unmounts the
vault form, locks its controllers and invalidates reviews. Each new workspace
starts locked; public scan/draft restore without rescanning. Current network and
coin checks remain mandatory for preparation. Legacy watched/demo screens remain
available when no authenticated local selection exists; selecting one in Wallets
clears local selection. No backend/bridge/cryptographic changes in this release.
Do not claim automatic/incremental synchronization or live balances from caches.

# Current release: 0.25 visible confirmed receipts and retained account history

Confirmation must preserve completed scan/history and its original timestamp.
Treat that snapshot only as discovery hints; current coins, raw parents, change
history, fees and checkpoint remain mandatory in preparation. Display old balance
as last-scan data. Read existing v1 confirmed archives for the authenticated account,
validate their signed amounts/recipients, and show receipts across reloads. Local
confirmation labels are historical observations, never fresh network proof.
User-funded web receive/sign/send was verified confirmed at block 974798 on
2026-09-30. Older outgoing-unverified notes below are superseded. Still preview,
not full-featured 1.0. User performs every real financial submission.

# Current release preparation: 0.24 acknowledged-payment clarity

Acknowledged receipts show Sent — awaiting confirmation. Hide submission consent
and retry controls in that state, including after reload, and guard submit().
Unknown outcomes retain exact-original retry and advise checking confirmation.
Never create a replacement payment automatically or alter saved signed bytes.

# Current prepared release: 0.23 durable public scan and payment draft

Completed account observations persist locally, scoped by origin, pinned XBT
checkpoint profile and authenticated xpub hash. They are untrusted display data
and address hints, never spendability proof. Restore validates bounds and derives
every address from the authenticated xpub. Public selection survives background;
reload/navigation still requires unlocking the same encrypted wallet.
Unsigned recipient/amount/fee drafts persist. Consent, reviews and keys do not.
All live coin/raw-parent/checkpoint/fee checks remain required. Old observations
no longer force full discovery solely because they are five minutes old. Include
locally issued addresses in current coin reads and check newly reserved change
against live history. Durable signed receipts and explicit submission stay intact.
Do not claim an iPhone funded outgoing transfer passed: it remains unverified.

# Current prepared release: 0.22 scan navigation fix

Public account scan sessions now survive same-tab navigation and visibility changes.
Only public AccountReader/results/receive indices are retained; keys and payment
reviews still lock/invalidate on navigation. Actor and authenticated xpub scope the
bounded in-memory cache. Completed timestamps never refresh just by restoring.
Partial scan resume retains the existing five-minute pause expiry. Reload/close
still clears this memory cache; do not claim durable scan storage. Vault storage
invalidation and confirmed payment clear the cache. A refresh retains the previous
view but invalidates spending until a successful completed scan. All signing,
checkpoint, durable issued-index and explicit submission gates remain unchanged.
User-facing 0.22, not 1.0. Actual incoming test transfer was verified through the
production canister on 2026-09-30; outgoing web spending remains unverified.

# Version numbering correction

User clarified on 2026-09-29: this release is 0.20, next is 0.21, then 0.22.
1.0 marks the ready-to-use release. The earlier 0.16 request was a misunderstanding.
A label-only Caffeine publication may have its own internal revision number;
retain public release 0.20 for this correction, and increment public releases next.
Do not reset the first-launch marker when changing versions.

# Current release: RedWallet 0.16 preview

The user supplied an iPhone screenshot on 2026-09-29 showing the production
local encryption and XBT signing self-test passed; no transaction broadcast.
This closes the requested iPhone public-fixture compatibility gate. It is not
an end-to-end funded web send test. Activation of the existing constrained
relay is authorized; record actual capability after private operator activation.
User-facing version is 0.16, distinct from Caffeine revision numbers. Reserve
1.0 for the first working full-featured version. First-launch video is hosted
same-origin and shown once per browser storage, independent of app upgrades.
Existing cryptographic, CSP, checkpoint and explicit user submission gates stay.
Native worktrees and secrets must remain untouched. User performs all real
financial submissions. Older disabled-send notes below are historical once
activation is verified, not a reason to remove any validation.

# Current phase: reviewed payment UI and device validation

User authorization covers implementation and deployment. The reviewed client
SendPaymentPanel is now wired only inside the same CSP-gated wallet workspace.
SpendPreparation additionally requires the live bridge broadcastEnabled=true;
the current operator setting remains false. Thus payment signing/submission
cannot be reached from new-wallet preparation in this revision. The separate
Browser compatibility self-test uses only the published disposable regtest
fixture, encrypts/signs locally, and never stores or broadcasts it.

Review, local signing, durable signed receipts, explicit submission and fresh
confirmation/archive are tested. Locking, edits, background/navigation and
wallet changes invalidate active reviews. The signed original is preserved
through unknown outcomes; no replacement signing or automatic submission.
Before enabling live broadcast, complete actual iPhone/browser compatibility
validation (FULL-WALLET-UI-GATES.md). Actual activated-XBT regtest acceptance,
Bitcoin replay-negative evidence, production CSP, bridge/canister reads and
PocketIC gates are already recorded as passed. Never treat the public fixture
as a receiving/spending wallet. Native worktrees remain untouched.

Historical scope notes below describe prior revisions and are superseded by
this current phase. Never claim the current deployment sends funds while the
operator broadcast gate is false.

# Current phase: constrained signed relay preparation

The user authorizes continued full-wallet implementation and deployment. The
new transaction.broadcast bridge route is authenticated, checkpoint-gated and
requires ENABLE_BROADCAST=true; default and current live configuration are false.
The backend API relays only bounded already-signed bytes, never private keys.
PendingPayments and SpendPreparation are isolated, tested client foundations;
no signing or submission UI is mounted. The actual v16 production scan passed
82 addresses, balance/history and reserved receive-address copy with keys locked.
Older claims that UTXO/raw or encrypted recovery are undeployed are superseded.
Keep exact-source imports, quotas, CSP, pinned checkpoint and native worktrees.

# Current authorized phase: local encrypted account workspace

The user explicitly authorizes continued full-wallet implementation and deployment.
The production v15 CSP gate passed: its native enforced securitypolicyviolation
observer reported that the hosting analytics script was blocked, while the UI
remained Connected. This supersedes earlier preparation-only and seed-disabled
scope notes below for these exact client components: LocalWalletWorkspace,
LocalVaultPanel, AccountReadPanel on WalletsPage. They support local encrypted
create/recover/unlock and bounded public account reads. The workspace remains
unavailable unless the same-page browser block is actually observed.

No signing or broadcasting is mounted. Sending remains disabled. The service,
backend and bridge must never receive private key/seed/password material.
Never hardcode, upload, log, commit or paste real user secrets. User-entered
recovery material is processed only in the local form and encrypted vault.
The exact-source Import code flow must be used; chat attachments are not exact
imports. Public fixture testing is permitted; no mainnet funds are transferred.
The existing native worktrees and operator credentials remain untouched.

Older notes below are historical; apply this current scope and the latest
production record when they conflict. The prepared SpendReview/signing core
and bridge transaction parser stay disconnected pending full send integration.

# Latest verified continuation — 2026-09-29

Production v14 is live and watch-only. Direct menu Import code preserves exact
ZIP contents; chat attachments were reconstructed incorrectly and must not be
used as an exact import mechanism. v14 export matched all 255 uploaded files.
Local frontend 41 files / 278 tests passed, typecheck/build/Biome passed.
Live production canister probe at20:36:18Z passed status/checkpoint height974742,
balance/history/fees, empty UTXOs, raw175bytes and invalid-input rejection.
Older notes below saying UTXO/raw are undeployed are superseded. XBT activated
regtest acceptance and Bitcoin replay-negative evidence are in test/regtest.
CSP is first in deployed HEAD and real connection works; the new csp-monitor
and Settings observer are a narrow native browser-block diagnostic. Do not
claim runtime block enforcement until the production UI actually observes it.
LocalVaultPanel remains unmounted; no spending or broadcast UI is live.

# Project Guidance

## Current authorized integration preparation

The user authorizes continued work toward a full local-key wallet. The prepared
`components/vault/LocalVaultPanel.tsx` is a client-only create/recover/unlock form
tested with disposable/public fixtures, but it is deliberately not mounted in
any application route. The isolation test permits only this exact prepared form
and separately rejects imports that would mount it. Production remains
watch-only until actual deployed CSP enforcement and the subsequent UI review
pass. Do not expose this form by merely removing the isolation check. No keys
may enter a backend, bridge, network request, telemetry, log, or plaintext store.

## User Preferences

- Mobile-first, polished, iPhone and desktop
- Installable as a PWA
- Clear RedWallet branding with a calm, trustworthy, security-focused visual design
- Watch-only: entered-address balance/history/receive, manual price, honest connection status
- Send, seed and recovery stay disabled; the isolated signing core stays disconnected
- Never put keys, seeds, bridge secrets or operator identity into the frontend
- Bridge upstream is operator-configured only; no default or public upstream
- Keep the pinned operator principal, red UI, checkpoint and migration chain intact
- Read-only only: no broadcast, signing or private-key endpoint
- Retain exact test/typecheck/build results in a non-secret verification markdown in source

## Verified Commands

- **typecheck**: `pnpm typecheck`
- **fix**: `pnpm fix`
- **build**: `pnpm build`

## Learnings

- The migration 20260929_083000.mo sets adminAssigned := true, disabling first-user admin promotion; getApiDoc prose must state admin is pre-assigned by operator configuration/migration.
- The Settings Support RedWallet disclosure lives in src/frontend/src/components/settings/SupportSetting.tsx and is mounted as the last card in SettingsPage's right column; it reuses the canonical copy-to-clipboard pattern and the raw-address QRCodeSVG approach (no URI scheme).
- Radix CollapsibleTrigger renders a native button with aria-expanded/aria-controls automatically, so a collapsed disclosure needs no manual ARIA wiring.
- The headless local-test browser denies clipboard access, so copy-success feedback cannot be exercised there; the app's failure feedback path is what the local tester observes.
- The isolated XBT wallet foundation under src/frontend/src/lib/xbt now includes key-material.ts, vault.ts, vault-controller.ts and spend-plan.ts plus their tests and KEY-VAULT-AND-SPEND-PLAN.md; it is imported only by its own tests and harness and must stay disconnected from every route, service and backend file.
- The foundation archive is extracted at .recon/foundation-81dbe45ab; this environment has only python3 and tar, so extraction uses `python3 -m zipfile -e`.
- The foundation adds bip32 5.0.1 and @scure/bip39 1.6.0 to src/frontend/package.json; pnpm-lock.yaml is regenerated with `pnpm install --no-frozen-lockfile` at the workspace root, and pnpm-workspace.yaml keeps the Caffeine-safe onlyBuiltDependencies/ignoredBuiltDependencies policy.
- Biome's useTemplate rule rejects string concatenation in the imported xbt tests; `pnpm --dir src/frontend fix` applies the safe fixes and the lint gate is `caffeine check --fix`.
- An app-only src/frontend/src/test/xbt-isolation.test.ts statically scans pages/services/components/App.tsx/backend/bridge to enforce the signing-core isolation invariant.
- The imported xbt files may diverge from the archive only by biome import-member ordering from `pnpm fix`; compare semantics, not raw bytes, for those files.
- The read-only spending-data layer adds bridge methods address.utxos (blockchain.scripthash.listunspent) and transaction.raw (blockchain.transaction.get with verbose=false), plus Motoko getAddressUtxos/getRawTransaction; the frontend adapters stay service-layer only and are not wired into any page.
- The bridge normalizes listunspent entries from tx_hash/tx_pos to txid/vout before returning, so the Motoko parser consumes the normalized shape, not the raw Electrum shape.
- In this Motoko toolchain, Int has toNat but NOT toNat32; an Int-to-Nat32 conversion must chain voutInt.toNat().toNat32().
- mops check --fix reports 'Fixed lib/bridge.mo (1 fix: M0236)' on every run without clearing a real M0070; fix the M0070 in source and ignore the repeated M0236 notice.
- The isolated XBT discovery overlay lives at src/frontend/src/lib/xbt/discovery.ts and is imported only by its own test; the isolation scan XBT_MODULES list now includes 'discovery'.
- After bindgen adds a new method, the generated BridgeResult_N numbering shifts, so existing method mappings in bridgeService.ts must be re-checked.
- The PocketIC backend lane ran with 13 tests; the configured-but-unreachable outcall path cannot complete under PocketIC's ingress budget, so the new parsers' success paths are covered only by pure Motoko unit tests.
- The live Umbrel bridge does not yet expose address.utxos/transaction.raw; the operator will review/export/deploy it privately and verify the actual canister afterward. No live UTXO/raw read has been performed or claimed.
- Verification results are recorded in src/frontend/src/lib/xbt/SPENDING-DATA-VERIFICATION.md (non-secret).
- The bridge UTXO height check in src/bridge/src/server.ts validateUtxos() now uses Number.isSafeInteger(height) && height >= 0, matching the tip-height, address.balance and address.history checks; a regression test in src/bridge/test/spending-data-bounds.test.ts rejects unsafe/non-integer heights.
- VaultController captures both a wall-clock (Date.now) and a monotonic (performance.now) five-minute deadline at unlock and enforces both synchronously in withUnlocked()/locked via #expired(), so a delayed timer or a backwards wall clock cannot extend the session; optional injectable now()/monotonicNow() clocks make the regressions testable.
- In this environment the bridge node:test suite reports 67 passing tests and the frontend vitest suite reports 31 files / 219 tests; the PocketIC backend lane has 13 tests.
- The PocketIC backend lane (13 tests) covers input validation, authentication, unconfigured state and API-docs only; a configured-but-unreachable HTTPS outcall cannot complete under PocketIC's ingress budget, so successful outcall parsers are covered by pure Motoko unit tests and live probes follow privately.
- src/frontend/src/lib/xbt/FULL-WALLET-UI-GATES.md records the subsequent wallet integration requirements before any signing/seed UI is wired in.
- The attached review-fixes ZIP under .platform/attachments/ cannot be extracted in this environment (no shell tool; binary read denied; image inspector rejects non-images), so review fixes must be applied from the user's written specification plus discovery of the current source.
