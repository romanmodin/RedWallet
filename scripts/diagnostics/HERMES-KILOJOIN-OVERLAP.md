# Overlapping creator votes after a verified roster

The Kilombino replay clarification permits duplicates and out-of-order channel
history. Local parent `6bcf4d422bee8f38554e1ecda8b2abc733271817` retained cancelled
vote IDs, but dropped a different `vote_open` while already voting. For example,
a valid roster followed by vote A, vote B, reopen A left the participant open
with B lost. No ownership or transaction defect is needed to reproduce this.

The correction retains up to 32 following creator-authenticated vote requests
while a vote is active. Each request must name a member of the currently verified
roster and have an unexpired deadline. It cannot change the active vote, persist
new session state, publish a vote, request a spending signature or release coins.
Duplicate IDs retain their original deadline; conflicting caller identities and
resource exhaustion fail closed.

On creator reopen, the matching request is removed. If the active vote ended,
the next eligible request is promoted; cancelled, expired or no-longer-present
callers are discarded. Cancellation history and the new active state are saved
in one encrypted transition. Only after successful storage is the local queue
replaced. A failed save leaves the active vote and pending requests intact.

The queue is local to the current controller instance, like the existing initial
vote deferral. This is not a new crash-resume or automatic reconnection feature.
The encrypted active state and journal retain existing recovery rules. Requests
received before any verified roster retain the existing strict initial-vote
handling, including rejection of conflicting initial requests. This change does
not claim every arbitrary pre-roster history is solved.

Tests use synthetic coins and public Kotlin fixture payloads:

- All six orders of two votes and one cancellation, both script types, 1/5 outputs.
- All 120 orders of three votes and two cancellations after a verified roster.
- Storage failure, deadline retention, cancelled/expired/removed/unknown callers,
  wrong authority, duplicate identity and the 32-request resource bound.
- Twelve complete fixture combinations through the real serialized relay with a
  socket double, using a rapid roster/A/B/reopen-A burst. No relay error, lost
  roster, extra chain query or publication is allowed.
- 120 actual pinned Hermes cases: twelve Kotlin fixtures (both scripts,
  2/5 participants, 1/2/5 outputs), six two-cycle orders and four three-cycle
  orders. They check unchanged reservations and zero spending signatures or
  publications, including after re-encrypted old-cycle messages.

Run with the temporary external tooling already used for the other diagnostics:

```sh
REDWALLET_ESBUILD_MODULE=/tmp/redwallet-hermes-bundler/node_modules/esbuild \
REDWALLET_HERMES_DIAGNOSTIC=overlap \
node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/redwallet-overlap.js
/tmp/redwallet-hermes-250829098.0.10/build/bin/hermes /tmp/redwallet-overlap.js
```

Add the full parent hash as the second bundler argument for the baseline. Only
`session.ts` is substituted, so fixtures and checks stay identical. Inspect JSON
counts and `fatal`; process success alone is not a passing diagnostic. See
`.github/release/IOS-KILOJOIN-OVERLAPPING-VOTES-20261023.json` for retained results
and artifact hashes.

The Linux Hermes VM is not native iOS qualification. No real funds, live relay,
spending signer or transaction broadcaster is used. A lost following vote can
stall a session, but this finding alone does not establish the exact cause of
the user's joining/zero-participant screenshot.
