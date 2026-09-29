# Project Guidance

## User Preferences

- Mobile-first, polished, iPhone and desktop
- Installable as a PWA
- Clear RedWallet branding with a calm, trustworthy, security-focused visual design
- Watch-only: entered-address balance/history/receive, manual price, honest connection status
- Send, seed and recovery stay disabled; the isolated signing core stays disconnected
- Never put keys, seeds, bridge secrets or operator identity into the frontend
- Bridge upstream is operator-configured only; no default or public upstream
- Keep the pinned operator principal, red UI, checkpoint and migration chain intact

## Verified Commands

- **typecheck**: `pnpm typecheck`
- **fix**: `pnpm fix`
- **build**: `pnpm build`

## Learnings

- Docker is unavailable in this environment, so the bridge Dockerfile is authored but not build-verified.
- A real HTTPS outcall to a non-answering host exhausts PocketIC's 100-round ingress budget (BadIngressMessage), so the configured-but-unreachable path is covered only by pure Motoko unit tests and the mocked frontend service seam.
- The reviewed RedWallet source (romanmodin/RedWallet commit 77837a6d4, branch web/caffeine-bridge-deployment) is the source of record; the archive is extracted at .recon/redwallet-archive.
- The one intentional divergence from the archive is pnpm-workspace.yaml: keep the Caffeine-safe onlyBuiltDependencies/ignoredBuiltDependencies policy instead of the archive's allowBuilds key, which would re-enable the @dfinity/pic GitHub PocketIC binary download.
- The backend bridge client uses mo:json (json = 1.4.0 mops dependency) with strict unwrapResult + uniqueKeys duplicate-key rejection.
- BridgeLib.validAddress accepts only alphanumeric characters (14-90 chars); the demo literal 'xbt-demo-address-not-valid' is rejected as invalid_input before any not-configured check.
- BridgeLib.validSecret requires 32-256 printable characters, so any test fixture secret shorter than 32 chars traps setBridgeConfig.
- The pinned operator principal nxkke-m27nb-dfnhs-cw533-g6lfi-ajhii-ffhn2-rhyb2-e5af4-aoarh-dqe lives only in the backend migration 20260929_083000.mo; the frontend never references it.
- The reviewed bridge allowlist has 7 read-only methods including server.status (maps to blockchain.headers.subscribe) and headers.checkpoint (maps to blockchain.block.header).
- The isolated XBT signing core under src/frontend/src/lib/xbt is imported only by its own tests and harness; it must stay disconnected from every route and service.
- The PocketIC backend lane runs in this environment (sidecar reachable, wasm installs) and its 8 tests exercise the real compiled canister; it is not a skip.
- The bridge is already live at https://umbrel-3.tailaa2bb4.ts.net:10000; the operator configures the backend privately with configure-canister.mjs after deploy, so live connectivity must not be claimed before that.
- NetworkStatusProvider is mounted once in App.tsx above the router; NetworkIndicator and StatusPage read the shared context, so no per-mount fetch remains and refresh() broadcasts one result to every consumer.
- bridgeService.getNetworkStatus caches a single in-flight promise and clears it on settle, so concurrent reads dedupe while a later refresh starts fresh.
- QuickActions hints are static watch-only copy (Send 'Sending unavailable — watch-only', Receive 'Share your public address'); no wallet-state branching is needed because Send/seed/recovery are disabled app-wide.
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
