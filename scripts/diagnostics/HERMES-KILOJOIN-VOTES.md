# Cancelled vote replay and creator resolution

This follows the Kilombino replay clarification and compares the participant
controller to Kilowallet commit `233733def7e492084f4d57e5faa1d76b9ab2ce79`.
`PoolSession.creatorOnVote` publishes a roster/reopen when a participant declines.
Its timer also publishes closing or roster/reopen after `Protocol.VOTE_SECONDS`
(600 seconds); participants allow `VOTE_GRACE` (180 seconds) for resolution.
The [protocol](https://github.com/Kilombino/kilojoin/blob/master/docs/PROTOCOL.md)
section 3 explicitly describes those timeout resolutions.

Two defects were reproduced against local parent
`f68a3410d2ef05e76dd6c9cf86c34256cc85f4c2`:

1. Reopen arriving before its vote/roster was lost. After a processed reopen,
   newly encrypted copies of the old vote could reactivate it. The controller
   now retains cancelled vote IDs in encrypted state, including before the
   matching vote arrives. It clears a matching pending vote only after the save
   succeeds. An old cancellation cannot cancel a different active vote.
2. The vote deadline also rejected the creator's resolution after timeout.
   Creator roster/reopen/closing now use the original pool deadline and the
   upstream three-minute resolution grace. The participant's own vote still
   expires at the original vote deadline. Closing retains its independent
   deadline, ownership/unspent checks and later review/signing requirements.

Cancellation metadata is bounded at 256 IDs and never evicted. Exhaustion fails
closed without reviving an old vote. No automatic vote, spending signature,
broadcast, reservation release, or retry of a wallet action is introduced.

The new unit cases cover all six permutations of roster/vote/reopen for both
script types and 1/5 outputs, re-encrypted duplicates, next-vote liveness,
wrong authority, encrypted-storage failure, resource limits, and resolution
before/after all relevant deadlines. Corrupt ownership and missing chain
observations still fail before any blinded output request.

The Hermes matrix uses the twelve public Kotlin startup fixtures (both scripts,
2/5 participants, 1/2/5 outputs) with disposable re-enveloping keys, unchanged
ownership proofs, six replay orders and three timeout resolutions: 108 cases.
The final timeout-roster cases also check the grace boundary. Only the timeout
closing cases may publish a blinded output request to an offline sink. No
spending signer or network is supplied; every case checks unchanged reservations
and an empty spending-signature map.

The first experimental Hermes harness incorrectly advanced assertions with an
extra async forwarding wrapper, and passed the encrypted closing envelope as
its body. Those runs are excluded. The retained baseline uses the corrected
harness, directly returning the session Promise and decrypting the actual Kotlin
closing body. The engine is the pinned Linux Hermes VM, not a native iOS build.

Run from the repository root, with temporary external esbuild and Hermes tools:

```sh
REDWALLET_ESBUILD_MODULE=/tmp/redwallet-hermes-bundler/node_modules/esbuild \
REDWALLET_HERMES_DIAGNOSTIC=votes \
node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/redwallet-votes.js
/tmp/redwallet-hermes-250829098.0.10/build/bin/hermes /tmp/redwallet-votes.js
```

Supply the full parent hash as a second bundler argument to replace only
`session.ts` with the baseline implementation. Inspect JSON `hermes`, `passed`,
`failed` and `fatal`, not just the process exit code. Exact results and artifact
hashes are recorded in the accompanying release evidence JSON.

These findings do not establish the exact physical-phone trigger. Native iOS
qualification and delivery remain separate. Multiple conflicting uncancelled
initial vote requests still fail closed; this change does not invent an ordering
for ambiguous histories or claim to handle every possible multi-cycle replay.
