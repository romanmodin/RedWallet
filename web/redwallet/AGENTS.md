# Project Guidance

## User Preferences

- Mobile-first, polished, iPhone and desktop
- Installable as a PWA
- Clear RedWallet branding with a calm, trustworthy, security-focused visual design
- Demo wallets remain clearly labeled; watch-only wallets use only live bridge data and explicit unavailable states
- Mock data behind a clean typed service interface, replaceable later
- Backend adapters kept separate from UI components
- Dashboard shown first
- UI is for XBT; avoid Bitcoin-specific wording and never present demo addresses as usable
- Demo cards use the neutral label; watch-only cards may show only the actual address explicitly entered by the user
- A live XBT connection requires the operator bridge and verified XBT checkpoint; otherwise show an explicit unavailable state
- Contact only the configured operator bridge via the canister; live fiat valuation is unavailable unless the user supplies a manual rate
- Bridge upstream is operator-configured only; no default or public upstream
- The released UI remains watch-only. The user authorized continued spending-wallet implementation on 2026-09-29. Develop the native XBT signing core in isolation and keep it disconnected from the UI until vault, recovery, UTXO verification, transaction review and broadcast gates pass. Never send wallet secrets to a canister, bridge, log or Caffeine prompt.
- Pin the checkpoint verified against live Knots and Fulcrum on 2026-09-29; never infer BTC chain identity

## Deployment direction

- The user authorized GitHub source storage, Umbrel bridge deployment and Caffeine publication on 2026-09-29.
- Dedicated bridge configuration is restricted to the pinned operator principal or the canister controller.
- Never commit operator private identity or bridge bearer secret; they are stored only in the private Umbrel deployment directory.
- Existing red layout and routes are retained; necessary controls in the existing wallet dialog and settings enable watch-only addresses and manual prices.

## Verified Commands

- **typecheck**: `pnpm typecheck`
- **fix**: `pnpm fix`
- **build**: `pnpm build`

## Learnings

- Settings default serverHost is an empty string by design — never substitute a public server; the status screen derives offline state from an empty host.
- Test suite is Vitest + jsdom + Testing Library under src/frontend/src/test; run with pnpm --dir app test.
- SendPage recipient validation intentionally rejects only empty/whitespace input; it does not validate any address prefix, so demo strings pass.
- ReceivePage exposes a module-level DEMO_RECEIVE_ADDRESS constant ('xbt-demo-address-not-valid') instead of deriving a per-wallet address string.
- Demo transaction counterparty addresses are the invalid literal 'xbt-demo-address-not-valid'; wallet short IDs use an xbt1 prefix and are identifiers, not addresses.
- The bc1 example in lib/format.ts lived only in the truncateAddress doc comment; the function itself is generic.
- Biome's pnpm fix step reformats unrelated files (line wrapping) during check; verify the diff is formatting-only before reporting changed files.
- NetworkName is narrowed to a single 'unconfigured' variant; the settings normalizer rejects any persisted mainnet/testnet value back to the safe default.
- NetworkSetting takes no props and ServerSummary dropped its network prop, so StatusPage/SettingsPage call sites must be updated together or typecheck fails.
- fiatRate.ts serves only the local fallback constant; fetchFiatRate is retained as an async ServiceResult wrapper so callers compile without any network path, and DashboardPage seeds the rate with a synchronous useState initializer.
- Wallet shortId is the neutral literal 'Demo address — not real' for all seeds and added wallets; no xbt1/bc1 address strings remain in UI data.
- Biome's fix step collapses a JSDoc block onto the following declaration line when the blank line after the comment is removed; keep the blank line to avoid the artifact.
- The bridge is a new pnpm workspace package under src/bridge; root recursive scripts pick it up, but the root test script is not recursive and must be extended to run the bridge tests.
- pnpm install --no-frozen-lockfile is required after adding a new workspace package.
- The bridge's validateRequest requires params to be a JSON array; the canister must serialize params as an array or the bridge rejects with invalid_request before upstream contact.
- The bridge allowlist includes server.status, server.version, server.features, address.balance, address.history, fee.estimate and headers.checkpoint. server.status returns the verified checkpoint and current height; server.version returns an array [serverVersion, protocolVersion].
- Successful bridge responses are wrapped as { result: <upstream result> }; a non-2xx response carries { error: { code, message } }. Parsers must unwrap result and treat a missing envelope or error object as malformed.
- A shared function (including the http_request transform) cannot be declared in a lib module — it must be a public field of the actor/mixin; pass it into lib helpers as an optional parameter.
- The IC http_request transform signature is a single record argument: shared query { context : Blob; response : HttpRequestResult } -> async HttpRequestResult.
- A generic helper returning Types.BridgeResult<T> cannot be used from a shared function (M0033); return a concrete type such as BridgeResult<Text>.
- Blob.fromArray is deprecated; use [].toBlob().
- mops test discovers *.test.mo under a test/ directory; mops check --fix verifies stable compatibility against .old/src/backend/dist/backend.most and the new migration's OldActor must equal the previous migration's NewActor.
- The app's test harness mounts <App /> without InternetIdentityProvider/QueryClientProvider; the React-free service layer resolves the canister lazily via createActorWithConfig(createActor) and degrades to the demo service when CANISTER_ID_BACKEND is unset.
- Docker is unavailable in scratch, but the Node 22 bridge image was built and verified on Umbrel on 2026-09-29.
- A real HTTPS outcall to a non-answering host exhausts PocketIC's 100-round ingress budget (BadIngressMessage), so the configured-but-unreachable path is covered only by pure Motoko unit tests and the mocked frontend service seam.
