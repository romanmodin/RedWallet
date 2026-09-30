# RedWallet Web0.30 — shared default and direct home WSS

Preserves the unpublished0.29 bridge-URL form fix and existing0.28 NeoxEX
Auto/Manual pricing. New browsers continue to use the built-in shared relay;
existing provider selections are preserved. Primary Settings options are built-in
and My home Fulcrum with one WSS URL, Test and tested Save. Legacy personal
HTTPS/ICP adapter fields remain under Advanced HTTPS adapter.

The same-origin dedicated worker implements bounded Electrum JSON RPC for all
public wallet reads and already signed broadcasts. Strict inputs/frame/response/
request/time limits, exact extended XBT header pin at961640, fresh tip timestamp,
anti-regression height, raw transaction ID and native P2WPKH Unified0x21/DER
signed-format checks are enforced. No arbitrary method forwarding, key/vault/
storage/ICP imports, automatic retries, or public fallback in direct mode.
Provider changes close old workers and invalidate old reviews/in-flight data.
Saved wallets, public caches, pricing and signed receipts remain intact.
Main document CSP and key/signature/migration/native source remain unchanged.
Auto pricing still uses its separate public service without wallet addresses.

## Verification before import

- Frontend61files /362tests PASS,78.29s, with jsdom and two workers.
- TypeScript PASS; Biome216files PASS; Vite production build PASS.
- Existing ancestor React Native tsconfig and aged Browserslist warnings remain.
- Eight real-protocol fixture tests validate all Electrum read mappings, exact
  checkpoint/freshness, strict formats/bounds, public signed unfunded fixture,
  mismatch unknown/no retry, BTC replay-negative and close/no reconnect.
- Fifteen provider route tests include direct dispatch with zero canister loads,
  no fallback on failure, storage restore and provider-generation late rejection.
- Isolation source guards PASS; emitted worker has no vault/storage/ICP imports.
- Existing backend and bridge source are byte-unchanged from0.28, whose actual
  published backend artifact already passed25PocketIC tests. No new backend
  compilation/runtime result is inferred; Caffeine exact-source gate is pending.

## Operator endpoint

Backed up Fulcrum config and complete Tailscale serve JSON on Umbrel, then enabled
native WS on127.0.0.1:55004 and added only /fulcrum-ws to existing TLS10000 tunnel.
Direct endpoint:wss://umbrel-3.tailaa2bb4.ts.net:10000/fulcrum-ws.
Live workstation WSS negotiated Fulcrum2.1.2/protocol1.4 and matched exact164byte
checkpoint; tip974923. Post-change bridge health200, unauthenticated RPC401;
TCP55001, admin55002, stats55003, existing bridge root and unrelated8443/8444
routes preserved. Same node; no independent backup/redundancy is claimed.
No funded transaction, user key, password or operator secret used in verification.

Caffeine import/export/publication and actual browser WSS checks remain pending.

## Saved source and live worker follow-up

Implementation commit e31ab00f5c2973375c6f0cb6e38203882c2fec4a is confirmed
on GitHub and the Zorin web deployment checkout; checkout clean. Exact upload:
359files,7174526bytes,SHA256
3889ec2862132789a9eb4f9c5efaefcceb60467e1e5f695499ff08483afddc4c.
Caffeine Import code accepted it and displayed deployment in progress. The
browser then redirected to sign-in. Secure sign-in was not completed. Draft
compilation completion, export comparison, browser CSP/WSS and production
publication remain unverified and blocked by authentication. Do not repeat the
import before inspecting its existing result. Production remains0.28.

Live native WSS probe passed version/checkpoint/tip/fee/balance/history/UTXO.
The actual Vite-emitted worker168653bytes was executed on Zorin Node24 against
the public WSS endpoint: info verified pinned checkpoint/recent tip at974923,
and typed fee returned1000sat/kB. This is actual emitted-worker/live protocol
evidence, not a Chrome/Safari/Caffeine CSP result. No raw signed transaction
was submitted to the production node.

Account UI showed8.03Caffeine credits and credit-purchase auto-top-up off.
Official Caffeine docs say hosting cycle top-ups are automatic and charged from
credits at0.5credits/100billioncycles. No billing setting/payment changed; actual
canister cycle balance/runway is not known. Eight credits are not perpetual.
