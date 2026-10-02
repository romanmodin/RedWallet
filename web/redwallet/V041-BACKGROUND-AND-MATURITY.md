# 0.41 public scanning and mining reward maturity — 2026-10-02

Prepared source; public remains 0.40/Caffeine43 until actual import/export,
backend hash, publication and browser verification complete.

## Public-only scan lifecycle

A tab-scoped account session owns the running scan independently of React page
mounts. Navigating away, hiding the window and locking keys do not abort public
reads. No keys, passwords, controller or signing review enters the job. Only one
scan is active in a tab. Pause, provider invalidation, wallet switch/removal and
vault-storage invalidation stop it. Existing checkpoint persistence survives
reload; authentication is still required to reselect the public account after
reload. Completion updates the local Home/Activity observation.

A connection failure during a background/return cycle gets one read-only resume
attempt when visible. A failed retry needs explicit Resume/Reconnect; there is
no retry loop or automatic payment action. iOS can freeze or discard a minimized
browser, so this does not promise uninterrupted execution. Actual iPhone
suspension remains a device test. Desktop lifecycle tests simulate page events.

## Maturity rules and trust boundary

Primary source: https://github.com/bitcoinknots/bitcoin/pull/419
Current 29.x-knots source verified at
58398baf33e588779685ead478e6397bb28ed3d6 (2026-10-02).
CheckTxInputs in consensus/tx_verify.cpp, mainnet parameters in
kernel/chainparams.cpp, and MemPoolAccept::PreChecks / mempool reorg checks in
validation.cpp were reviewed.

Consensus requires 6,480 blocks for coins created at/after973440 when their
spending block is in [973440,979920); ordinary100-block consensus applies
outside that window or to older coins. The node mempool passes a start height
of0 and requires6,480 blocks for ALL coinbase inputs even outside that window.
Wallet preparation therefore enforces the stricter6,480-block relay rule using
next-block height (tip+1). It does not mark late-window rewards spendable merely
because the temporary consensus rule expires. This policy is pinned, not a
claim that future consensus changes will be automatically discovered.

Coinbase classification comes from verified raw parent bytes, not a server flag.
The txid-bound BIP34 prefix must match the claimed coin height (post-BIP34,
version2+); value/script/outpoint/ownership checks run before an immature reward
can be excluded. Only typed immature-reward errors are skipped. Malformed or
forged parents fail preparation. The100-confirmed-output bound includes skipped
rewards. No eligible coins gives a specific immature-reward message. Mixed
ordinary coins remain usable. Planning and signing repeat the maturity check;
review expiry/provider and fresh network checks remain unchanged. Displayed
scan balance remains historical confirmed balance, not a spendable guarantee.

## Verification

Initial full run:416passed/1failed across65files. The failure was a static
remote-origin scanner matching the upstream URL in a source comment. Moved that
citation to this report; did not weaken the scanner or CSP.
Final focused35tests PASS (including locked-key/public lifecycle, completion
after unmount, one-return retry, provider cancel, maturity boundaries, encoded
height forgery, mixed ordinary/immature selection and mature Unified signing).
TypeScript, Biome224files, production build and production audit0advisories PASS.
Clean CI final full suite and bridge lane recorded in subsequent status entry.
No funded transaction was sent. No new live-node coinbase acceptance claimed;
existing signer node/replay fixtures remain unchanged. Native app, bridge and
backend source untouched. Actual compiled backend hash must remain unchanged.

## Live verification follow-up: 0.42

0.41/Caffeine44 published: all385source paths match actual export, unchanged
backend hash. Live crypto self-test passed. Returning from Home exposed a fresh
ProviderRouter proxy identity: the old public scan keeps running but the newly
mounted view observes only its saved checkpoint.0.42 retains the guarded proxy
identity only for the same provider connection+generation, after existing
resolution checks. Reconnect still replaces identity and rejects old reads.
Regression covers repeated resolve and reconnect. No freshness check bypassed.
0.42 publication and live navigation verification pending.
