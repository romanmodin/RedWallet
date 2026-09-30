# RedWallet connection options

The built-in shared relay remains the default. Settings also offers a direct
secure WebSocket connection to a user-owned XBT Fulcrum. Existing personal
HTTPS adapter configurations remain available under Advanced HTTPS adapter.

## Direct home WebSocket

Enter one `wss://` URL under My home Fulcrum, then Test connection and Save.
No ICP canister or application bridge is required. Enable Fulcrum native WS
behind a trusted TLS reverse proxy, or native WSS with a browser-trusted
certificate. The ordinary Electrum TCP/TLS port is not a WebSocket port.
The address must be reachable from the phone/browser: home LAN, VPN, or a
public TLS endpoint. The RedWallet page requires secure WSS even for home LAN.

The browser worker talks directly to this endpoint using bounded Electrum JSON
RPC. It receives only public addresses/IDs and already signed transactions,
never a seed, private key, password, or vault. Before accepting a provider it
checks the exact XBT extended checkpoint header at961640, recent header time,
and chain height. Every wallet read and signed broadcast uses the selected
connection. Failure stays disconnected; direct mode never falls back to the
shared relay. Changing providers invalidates old reviews/in-flight results and
closes the old worker while preserving saved wallet data and receipts.

Auto NeoxEX pricing still uses the public price service, without wallet data.
Direct wallet routing does not make asset hosting or price requests independent
of ICP. The main page CSP remains unchanged; its same-origin network worker
has no key, vault, storage or ICP dependencies.

Operator verification endpoint enabled2026-09-30:
`wss://umbrel-3.tailaa2bb4.ts.net:10000/fulcrum-ws`. Fulcrum WS binds only to
loopback55004; the existing Tailscale TLS tunnel forwards this path directly.
The existing authenticated HTTP bridge root and ports8443/8444 remain intact.
This is the same home node, so it adds no independent redundancy.

## Advanced HTTPS adapter

The ICP adapter makes authenticated HTTPS outcalls to an operator-hosted bridge.
The bridge opens TCP/TLS to one configured Fulcrum. Neither component accepts
caller-supplied upstream hosts or arbitrary methods. This service provides public
chain data checked against a pinned checkpoint and recent tip; it is not a full
node consensus proof. The bridge does not receive wallet private keys.

## Existing built-in public service

The public RedWallet canister is `7gylz-gyaaa-aaaab-qhjrq-cai`; its bridge is
`https://umbrel-3.tailaa2bb4.ts.net:10000`. Only the canister sends the private
operator credential. The bridge's direct unauthenticated `/rpc` remains 401.
Users need no account, host, credential, or server setting to use the built-in
service. This endpoint depends on the home Umbrel. It is not an independent backup.

## Host your own adapter

1. Run `src/bridge` next to your own XBT Fulcrum using the Dockerfile. Set
   `FULCRUM_HOST`, `FULCRUM_PORT`, `FULCRUM_TLS`, a private `BRIDGE_SECRET`, and
   the trusted checkpoint height/hash/exact extended header bytes. Pin height
   961640 and hash
   `0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb`;
   independently verify the exact header against your XBT node. Do not assume
   an 80-byte BTC header or replace the XBT hash rules. Plain TCP is accepted
   only on literal loopback; remote upstreams require verified TLS.
2. Expose the bridge behind a valid public HTTPS certificate. Keep `/rpc`
   authenticated, bind the HTTP listener to loopback, and preserve its request
   bounds, quotas, checkpoint gate, and default-disabled broadcast gate.
   Sending requires the operator's explicit `ENABLE_BROADCAST=true` opt-in;
   the signed format and transaction validation still apply.
3. Deploy a **separate** canister using this project's backend and existing
   enhanced-migration workflow (for example an exact-source Caffeine import).
   Its controller must appoint its own bridge operator with `setBridgeOperator`.
   That operator calls `setBridgeConfig(bridgeBaseUrl, privateSecret)` privately.
   Do not reconfigure the shared RedWallet canister. Follow the existing private
   operator helper workflow in `deploy/umbrel/README.md`; credentials belong on
   the operator's host, never in a Caffeine prompt or frontend/source archive.
4. Verify `getProviderInfo` reports the actual host/port/TLS, exact HTTPS base URL,
   pinned XBT checkpoint and a header-derived tip timestamp within two hours.
   Older bridges/canisters missing this method must be updated before selection.
5. In Settings → Network → Advanced HTTPS adapter, enter those exact host/port/TLS values,
   HTTPS bridge base URL and adapter canister ID. Test connection verifies that
   exact adapter. Save persists only this origin/device's selection. The known
   home HTTPS URL can resolve its adapter ID automatically. A different bridge
   needs its own adapter ID; an arbitrary raw hostname alone cannot work.

HTTPS endpoint and canister ID are public identity, not credentials. The
canister's public `getProviderInfo` deliberately exposes only this identity.
Every custom balance/history/UTXO/fee/raw/broadcast route goes to that adapter.
With optional fallback disabled, a custom failure never contacts the shared
service. With explicit fallback enabled, the active service visibly changes to
the built-in service; reviews and consent are invalidated and fresh reads required.
Wallets, issued-address indices, historical scans, drafts, and signed receipts
remain saved. An uncertain transaction is queried by the existing ID before retry;
if its presence cannot be ruled out, no retry or replacement payment is dispatched.

## Independent built-in backups

`BUILTIN_BACKUPS` in `services/providerService.ts` is intentionally empty.
Only add an adapter after live testing on a separate host/node/failure domain.
Record its canister ID, name and exact HTTPS bridge base URL; verify checkpoint,
recent header time, balance/history/UTXO/fee/raw routes, disabled/invalid broadcast
rejection, and primary-outage failover. A recent backup must also be no more than
six blocks behind the last observed healthy tip. Local router tests prove the
selection logic; they do not establish production redundancy. Never label a
second canister that still calls the same home node as an independent backup.
