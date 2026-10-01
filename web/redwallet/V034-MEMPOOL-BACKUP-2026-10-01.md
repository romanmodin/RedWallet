# 0.34 — Umbrel primary, mempool.guide WSS backup

Published as Caffeine version36 / public RedWallet0.34 on2026-10-01.
All368 reviewed source files from commit3b28972 exactly match the actual
compiled export. Backend Wasm remains unchanged (690890bytes; SHA256 below).
Caffeine reports version36 live; the public Settings page shows0.34 and the
configured home-primary/mempool.guide-WSS-backup privacy/payment disclosure.
The public browser subsequently connected to the home HTTPS bridge and adapter
7gylz-gyaaa-aaaab-qhjrq-cai with built-in selected. External analytics remains
blocked. Proof: redwallet-034-primary-backup.jpg. No production outage was induced.

The built-in service tries the home Umbrel adapter first. If it is unavailable,
the fixed backup is wss://mempool.guide/electrum-websocket/, using the existing
same-origin public-network worker. This needs no additional canister, private
bridge credential, full node or paid hosting. The endpoint identifies as
mempool-electrs 3.4.0-dev-4453cac, protocol 1.4.

Settings identifies mempool.guide when active and distinguishes WSS from HTTPS
adapter routing. It explains the backup sees public address queries, signed
transactions and device IP. Personal WSS remains strictly direct. Custom HTTPS
uses public fallback only when enabled. Healthy backup workers are reused;
failed workers are retired and recreated after cooldown. Later checks try the
primary first again. Every actual service change invalidates stale actors and
payment reviews. Failed reads are not automatically replayed; subsequent fresh
reads use the new service. Broadcasts are never automatically retried or switched.
Saved wallet history, discovery hints and receipts are unaffected.

## Verification

- Actual published 0.33 browser worker Test connection to mempool.guide passed
  at975042 without saving a different active provider. Home remained primary.
- Bundled actual DirectFulcrum source ran on Zorin Node24 against public BIP84
  address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu. Info/status, exact961640
  checkpoint, recent tip, zero confirmed/pending balance,176history entries,
  empty UTXO list, fee1011sat/kB and223-byte raw transaction with verified ID
  passed. Invalid signed bytes rejected locally. Probe exit0 at16:51:10UTC.
- One explicitly malformed unsigned payload `00` was sent to the public
  broadcast method to confirm it exists and rejects decoding. It returned
  underlying node error-22, TX decode failed, at16:54:20UTC. This creates no valid
  transaction and is not successful funded-broadcast evidence.
- Actual ProviderRouter plus actual DirectFulcrum source ran with only the
  primary loader deliberately throwing. Production primary stayed untouched.
  One primary attempt, one direct loader, active mempool.guide backup and a
  fresh public balance read passed, exit0 at16:56:45UTC.
- Full frontend suite62files/374tests PASS after version-metadata expectations
  were updated. A final custom-privacy display refinement adds one test; its
  routing/display lane28tests PASS, covering all changed routing and copy.
- Frontend typecheck, Biome217 and production build PASS. Existing ancestor
  React Native base-config and stale Browserslist warnings remain.

The routing suite covers primary priority, all backup wallet-read routes,
initial/runtime failover, stale actor/review invalidation, socket reuse/recreation,
primary recovery, bad checkpoint/time/endpoint/identity rejection, no broadcast
replay, and personal-WSS/custom-HTTPS privacy. Settings tests cover primary,
backup and custom-without-fallback identity/copy. The final source has375
distinct frontend cases; the new privacy test was run in the focused lane.

Zorin evidence directory: /home/roman_modin/.cache/redwallet-mempool-guide.
probe.log/probe.status, invalid-broadcast.json and router-probe.log/status hold
the live results. No private wallet or keys were used; no funded transaction,
real primary outage, new canister, infrastructure purchase or native app change.
Backend source, migrations, bridge source and the key-bearing document CSP are
unchanged. The published backend artifact must still match SHA256
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001.

This public service is a tested independent data-source candidate, not an
availability guarantee or permission to bypass rate limits. No additional
transaction formats or full node consensus proof are claimed.
