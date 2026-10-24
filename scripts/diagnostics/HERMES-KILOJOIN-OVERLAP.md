# Overlapping creator votes before and after a verified roster

The Kilombino replay clarification permits duplicates and out-of-order channel
history. Local parent `6bcf4d422bee8f38554e1ecda8b2abc733271817` retained cancelled
vote IDs, but dropped a different `vote_open` while already voting. For example,
a valid roster followed by vote A, vote B, reopen A left the participant open
with B lost. No ownership or transaction defect is needed to reproduce this.

The first correction retained up to 32 following creator-authenticated vote requests
while a vote was active, requiring the caller to be in the current roster.
The later roster-order correction described in `HERMES-KILOJOIN-ROSTER.md` also
retains unexpired requests awaiting their caller's newer roster. They cannot change the active vote, persist
new session state, publish a vote, request a spending signature or release coins.
Duplicate IDs retain their original deadline; conflicting caller identities and
resource exhaustion fail closed.

On creator reopen, the matching request is removed. If the active vote ended,
the next eligible request is promoted; cancelled and expired requests are
discarded. A caller absent from the current roster remains inactive, awaiting a
newer fully verified roster within the same deadline. Cancellation history and the new active state are saved
in one encrypted transition. Only after successful storage is the local queue
replaced. A failed save leaves the active vote and pending requests intact.

The queue is local to the current controller instance, like the existing initial
vote deferral. This is not a new crash-resume or automatic reconnection feature.
The encrypted active state and journal retain existing recovery rules.

A further regression against `f1fad61a970a4c10a4dc3fe703a7112c79838c50`
found that two distinct creator vote IDs arriving before the first roster threw
`Conflicting initial vote`. Sixteen of 96 permutations of roster/A/B/reopen-A
failed, while the post-roster cases passed. The initial queue now holds up to 32
distinct requests without activating any of them. After the full ownership,
chain and own-seat checks, the roster and first active request are saved
atomically. Eligible remaining requests transfer to the following queue only
after the save succeeds. A matching cancellation removes an initial request only
after durable persistence. Different callers claiming the same vote ID still
fail closed; duplicate IDs preserve their original deadline. Stop clears both
queues once journal cancellation is durable, even if terminal storage fails.

At this stage the first request could still reject a valid initial roster when
its caller was absent or its deadline had expired. The follow-up documented in
`HERMES-KILOJOIN-HISTORY.md` addresses that remaining case: such a request cannot
activate, but it no longer blocks a newer eligible request. Pending requests
remain instance-local; no automatic vote, transaction signature or broadcast is added.

Tests use synthetic coins and public Kotlin fixture payloads:

- All six orders of two votes and one cancellation, both script types, 1/5 outputs.
- All 24 orders including the initial roster, both script types, 1/5 outputs.
- All 120 orders of three votes and two cancellations after a verified roster.
- Storage failure, deadline retention, cancelled/expired/removed/unknown callers,
  wrong authority, duplicate identity and the 32-request resource bound.
- Twelve complete fixture combinations through the real serialized relay with a
  socket double, using rapid bursts with the roster first and last. No relay error, lost
  roster, extra chain query or publication is allowed.
- 216 actual pinned Hermes cases: twelve Kotlin fixtures (both scripts,
  2/5 participants, 1/2/5 outputs), six two-cycle orders and four three-cycle
  orders after a roster, plus eight sequences with the roster interleaved.
  They check unchanged reservations and zero spending signatures or
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
and artifact hashes for the first correction. The follow-up startup regression
is recorded in `.github/release/IOS-KILOJOIN-INITIAL-VOTE-REPLAY-20261023.json`.

The Linux Hermes VM is not native iOS qualification. No real funds, live relay,
spending signer or transaction broadcaster is used. A lost following vote can
stall a session, but this finding alone does not establish the exact cause of
the user's joining/zero-participant screenshot.
