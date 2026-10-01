# RedWallet0.32 — reconnect without requiring recovery discovery

User reports changing connection leaves a 0-address failed reader with
“Provider changed; fresh network reads required.” A failed refresh previously
withheld an existing completed snapshot from payment preparation, including
on same-actor remount. It now remains available as authenticated-account public
address hints once the read stops. While a read runs, reviews remain invalidated.
Balances and original observation timestamps remain explicitly historical.
SpendPreparation continues re-deriving addresses and checking live UTXOs,
verified raw parents, checkpoint, fees, and durable/live-checked change before
any review. Cached balances never authorize a payment. No initial completed
scan means initial discovery is still required; partial scans remain incomplete.

An explicit Reconnect selected connection button clears the bound provider
session, closes the previous WSS worker, increments provider generation, and
resolves the selected service. The new actor restores the completed scan and
draft without starting discovery. Old reads/reviews are rejected. Late WSS
connection checks cannot clear a newly reconnected session; stale proxy failures
cannot close the replacement connection. No automatic reconnect, fallback,
signing or submission retry was added. Provider-changed scan errors now explain
which button to use. Removed misleading vault copy requiring a fresh scan for
payment preparation. Refresh account deliberately remains a complete scan to
update displayed observations and discover transfers. No incremental balance
synchronization is claimed. Backend, bridge, native wallet, keys, CSP, checkpoints,
stable migrations and saved receipt formats are unchanged. Product version0.32.

## Validation before publication

Provider routing regressions cover explicit reconnect, old actor/in-flight read
rejection, no submission or canister fallback, and late connection-check isolation.
Real App navigation regression preserves saved balance, 42 derived addresses,
history and unsigned draft across provider handoff with zero recovery requests.
Account read-panel regressions retain completed hints after refresh failure and
remount. Existing old-scan/live-coins and one-shot provider-review tests pass.
Full frontend run:362 PASS plus2 obsolete release/error-copy assertions failed;
those assertions were corrected and their targeted reruns passed (metadata15,
workspace/read/vault9). All364 tests are covered; the full suite was not rerun.
Typecheck, Biome216 and production Vite build passed; existing ancestor React
Native config and Browserslist warnings persist. Caffeine exact-source import,
export comparison, publication and browser verification pending.

## Publication blocked — 2026-10-01 UTC

Implementation commit8a5b8d7f2 pushed to GitHub and Zorin, clean worktrees.
Exact source ZIP362files/7187762bytes/SHA256
da5cfbf78ee6925b77d5229f9218c62f78739be6406f29d25399b6be18e05281.
Public Settings was verified0.31/shared connected/analytics blocked before
publication. Caffeine internal33 remained current. Clicking Import code led
to Caffeine sign-in before a file chooser opened; no0.32 upload occurred.
Secure browserAuth method handoff selected Google; target page still displayed
Caffeine sign-in afterward. Publication/exact export/live behavior checks remain
blocked pending completion of sign-in. Do not claim this fix is live or duplicate
a build that has not been observed. User should reload/unlock existing vault on
0.31 as a temporary stale-actor reset; never delete or reimport their wallet.
