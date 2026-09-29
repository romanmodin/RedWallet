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
- Read-only only: no broadcast, signing or private-key endpoint
- Retain exact test/typecheck/build results in a non-secret verification markdown in source

## Verified Commands

- **typecheck**: `pnpm typecheck`
- **fix**: `pnpm fix`
- **build**: `pnpm build`

## Learnings

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
- The read-only spending-data layer adds bridge methods address.utxos (blockchain.scripthash.listunspent) and transaction.raw (blockchain.transaction.get with verbose=false), plus Motoko getAddressUtxos/getRawTransaction; the frontend adapters stay service-layer only and are not wired into any page.
- The bridge normalizes listunspent entries from tx_hash/tx_pos to txid/vout before returning, so the Motoko parser consumes the normalized shape, not the raw Electrum shape.
- In this Motoko toolchain, Int has toNat but NOT toNat32; an Int-to-Nat32 conversion must chain voutInt.toNat().toNat32().
- mops check --fix reports 'Fixed lib/bridge.mo (1 fix: M0236)' on every run without clearing a real M0070; fix the M0070 in source and ignore the repeated M0236 notice.
- The isolated XBT discovery overlay lives at src/frontend/src/lib/xbt/discovery.ts and is imported only by its own test; the isolation scan XBT_MODULES list now includes 'discovery'.
- After bindgen adds a new method, the generated BridgeResult_N numbering shifts, so existing method mappings in bridgeService.ts must be re-checked.
- The PocketIC backend lane ran with 13 tests; the configured-but-unreachable outcall path cannot complete under PocketIC's ingress budget, so the new parsers' success paths are covered only by pure Motoko unit tests.
- The live Umbrel bridge does not yet expose address.utxos/transaction.raw; the operator will review/export/deploy it privately and verify the actual canister afterward. No live UTXO/raw read has been performed or claimed.
- Verification results are recorded in src/frontend/src/lib/xbt/SPENDING-DATA-VERIFICATION.md (non-secret).
