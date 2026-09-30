# Public and personal RedWallet adapters

A web browser cannot open Fulcrum's TCP/TLS socket. This release deliberately
keeps the browser CSP unchanged. Every wallet route therefore uses an ICP adapter
canister, which makes authenticated HTTPS outcalls to its separately hosted bridge.
The bridge opens TCP/TLS to one operator-configured Fulcrum. Neither component
accepts caller-supplied upstream hosts or arbitrary RPC methods. No keys enter
these services. This is not a full-node consensus proof: an adapter is a provider
of public chain data, checked against a pinned checkpoint and recent tip.

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
5. In Settings → Network → My own Fulcrum, enter those exact host/port/TLS values,
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
