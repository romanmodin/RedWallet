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
