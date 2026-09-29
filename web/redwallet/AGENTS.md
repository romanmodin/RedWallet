# Project Guidance

## User Preferences

- Mobile-first, polished, iPhone and desktop
- Installable as a PWA
- Clear RedWallet branding with a calm, trustworthy, security-focused visual design
- Watch-only: entered-address balance/history/receive, manual price, honest connection status
- Send, seed and recovery stay disabled; the isolated signing core stays disconnected
- Never put keys, seeds, bridge secrets or operator identity into the frontend
- Bridge upstream is operator-configured only; no default or public upstream
- No private keys, transaction data, signing, construction, or broadcast anywhere
- Keep the pinned operator principal, red UI, checkpoint and migration chain intact

## Verified Commands

- **typecheck**: `pnpm typecheck`
- **fix**: `pnpm fix`
- **build**: `pnpm build`

## Learnings

- The bridge's validateRequest requires params to be a JSON array; the canister must serialize params as an array or the bridge rejects with invalid_request before upstream contact.
- The bridge allowlist is exactly server.version, server.features, address.balance, address.history, fee.estimate, headers.checkpoint — there is no server.status; server.version returns an array [serverVersion, protocolVersion].
- Successful bridge responses are wrapped as { result: <upstream result> }; a non-2xx response carries { error: { code, message } }. Parsers must unwrap result and treat a missing envelope or error object as malformed.
- A shared function (including the http_request transform) cannot be declared in a lib module — it must be a public field of the actor/mixin; pass it into lib helpers as an optional parameter.
- The IC http_request transform signature is a single record argument: shared query { context : Blob; response : HttpRequestResult } -> async HttpRequestResult.
- A generic helper returning Types.BridgeResult<T> cannot be used from a shared function (M0033); return a concrete type such as BridgeResult<Text>.
- Blob.fromArray is deprecated; use [].toBlob().
- mops test discovers *.test.mo under a test/ directory; mops check --fix verifies stable compatibility against .old/src/backend/dist/backend.most and the new migration's OldActor must equal the previous migration's NewActor.
- The app's test harness mounts <App /> without InternetIdentityProvider/QueryClientProvider; the React-free service layer resolves the canister lazily via createActorWithConfig(createActor) and degrades to the demo service when CANISTER_ID_BACKEND is unset.
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
