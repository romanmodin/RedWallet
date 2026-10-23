# Stale votes before the first verified roster

Parent `66b5a93cbeb611452ffacd42b1e260cfc59dc013` handled deferred votes
against later rosters, but unconditionally tried the first queued vote when
accepting the initial roster. An expired request or a request naming an absent
participant could therefore throw before a valid roster and newer vote were
saved. The same envelopes can succeed in another arrival order.

The new regression reproduced 16 failures among 48 Node cases and 48 failures
among 96 actual pinned Linux Hermes cases on that parent. With the correction,
all cases pass. Both scripts, one/five outputs, expired/absent callers and
roster interleavings are covered in Node. Hermes covers all 12 real Kotlin
fixture combinations, including two outputs and two/five participants.

Initial requests now go through the existing strict eligibility/promotion path
only after the roster passes ownership, chain, own-seat and sequence checks.
Expired requests are discarded. A live request naming an absent participant
remains inactive until a newer verified roster includes that participant. An
eligible newer request may activate without waiting for an ineligible older
one. The original 600-second vote deadline, pool deadline, quorum, creator
identity, duplicate-identity checks, bounded queues and cancellation rules are
unchanged. Roster and promotion are persisted atomically before queue mutation.
There is no automatic vote, spending signature or broadcast.

Two existing negative tests previously expected an exception on the valid
roster. They now explicitly require the invalid/expired vote to stay inactive,
the valid roster to persist, voting/signing to fail, the signer never to run,
zero publications and unchanged reservations. This changes the error behavior
without permitting the invalid vote. Added tests also cover insufficient quorum
and storage failure before a subsequent authenticated roster is accepted.

The diagnostic re-envelopes public Kotlin fixture payloads under disposable
known keys; original coin/proof content is unchanged. Backend observations are
synthetic. This tests parsing and state transitions, not a live chain backend.

```sh
REDWALLET_ESBUILD_MODULE=/tmp/redwallet-hermes-bundler/node_modules/esbuild \
REDWALLET_HERMES_DIAGNOSTIC=history \
node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/redwallet-history.js
/tmp/redwallet-hermes-250829098.0.10/build/bin/hermes /tmp/redwallet-history.js
```

Append the full parent hash to the build command to substitute only the old
session module. Check JSON counts, `fatal` and the actual Hermes marker; an exit
code of zero alone does not qualify a run. See
`.github/release/IOS-KILOJOIN-INITIAL-HISTORY-20261023.json` for recorded results.

This is an additional reproducible startup defect, not proof of the exact
failure observed on the user's phone. Native iOS/Hermes/Keychain qualification,
protected signing, TestFlight availability and Apple review each still require
their own receipts. No live relay, real wallet keys or real funds were used.
