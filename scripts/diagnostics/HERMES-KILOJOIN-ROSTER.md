# Votes arriving before a newer participant roster

Parent `7ccebfed99bf3d8cf848ed4faa0f9677902a27bd` handled overlapping
votes but still assumed the currently verified roster was sufficient for every
later vote. If a valid creator vote named someone included in the next roster,
the open state threw `Invalid vote caller`; the voting state silently dropped
the request. A one-seat roster followed by a quorum-forming roster had the same
problem. This can be reproduced without a connection failure or invalid proof.

The regression enumerates both orders of roster/vote while open, all six orders
of roster/vote/cancellation while voting, and both quorum-forming orders. Both
script types and one/five outputs are covered. The parent fails 20 of these 40
cases. No pre-existing assertion or release gate is removed or weakened.

The correction reuses the bounded 32-request following-vote queue. Requests
signed by the creator can wait for a newer roster without activating a vote or
publishing. The roster must still pass every ownership proof, chain observation,
own-seat, sequence, quorum and caller check. Only eligible requests are promoted.
Roster/cancellation and promotion are one encrypted save; the in-memory queue is
updated only after persistence succeeds. Duplicate identity checks, the original
vote timestamp, cancellation history and the pool deadline remain enforced.

This correction originally left the first-vote path before any roster unchanged.
The follow-up in `HERMES-KILOJOIN-HISTORY.md` now also keeps ineligible initial
requests inactive without rejecting a valid roster. Neither change adds crash
resume or automatic voting, spending or broadcasting. Queued requests are local
to the current controller instance.

The added safety tests cover stale rosters, invalid proofs, missing chain data,
changed own seats, failed storage, expiry, cancellation, unknown callers,
duplicate timestamps, conflicting identities and resource bounds. They require
zero automatic publications and unchanged reservations.

`hermes-kilojoin-roster.ts` runs 60 cases in the app-pinned Linux Hermes VM with
12 real Kotlin fixtures: both scripts, two/five participants and one/two/five
outputs. It re-envelopes public fixture payloads under a known disposable creator
key, leaving coin/proof content intact. The initial subset and the later full
roster both use the actual creator-issued seat identities. No live relay, wallet
keys, spending signer or broadcaster is available.

```sh
REDWALLET_ESBUILD_MODULE=/tmp/redwallet-hermes-bundler/node_modules/esbuild \
REDWALLET_HERMES_DIAGNOSTIC=roster \
node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/redwallet-roster.js
/tmp/redwallet-hermes-250829098.0.10/build/bin/hermes /tmp/redwallet-roster.js
```

Append the full parent hash to the bundler command to substitute only the old
`session.ts`; all fixture inputs and checks remain identical. Verify JSON counts
and the Hermes marker, not just process exit status. The first development run
incorrectly selected a fixture seat by its pre-welcome placeholder token; those
setup failures are excluded from evidence. The corrected harness selects the
seat by its proven join key.

Separately, Kilowallet's backend checks peer inputs for unspent/value/script,
whereas RedWallet also corroborates confirmed heights. The reference wallet's
normal coin picker explicitly filters `height > 0`, and its perfect-coin flow
waits for confirmation. No evidence established that confirmation policy caused
the phone failure, and RedWallet's confirmed-input requirement is unchanged.

Pinned reference checkout: Kilowallet
`233733def7e492084f4d57e5faa1d76b9ab2ce79`, `PoolSession.kt`,
`CoinjoinHub.kt`, `chain/ElectrumClient.kt` and `ui/WalletViewModel.kt`.
See `.github/release/IOS-KILOJOIN-ROSTER-VOTE-ORDER-20261023.json` for final
results and hashes. Linux Hermes is not native iOS qualification; this
reproduction alone does not establish the exact cause of the user's screenshot.
