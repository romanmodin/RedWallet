# Kilombino-confirmed replay compatibility

The October 23, 2026 developer reply and the retrieved upstream
[protocol sections 2–3, 11–12](https://github.com/Kilombino/kilojoin/blob/master/docs/PROTOCOL.md)
were compared with local candidate `5595d71a1ee2059b845c69094b0a37998709eabb`.

| Boundary                    | Finding and verification                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Short pool secret           | Already accepts 1–64 lowercase hex digits, pads to 32 bytes and checks the derived pool public key. Invalid scalars and wrong pool keys remain rejected.                                                      |
| Blind RSA key               | Already parses the modulus as a bigint and requires exponent 65537, encoded `10001`. Additional tests cover 2048-, 2049- and 4096-bit moduli, including an odd digit count.                                   |
| Creator seat proof          | Already checks each seat against its own `join_pub`. Explicit positive/negative tests show the creator seat accepts the pool key and rejects substitution of the creator authority key.                       |
| Duplicate/history envelopes | Defect: valid duplicates and irrelevant routes could become the participant-error banner. Dropped envelopes now cannot change session state; operational/state-validation failures still surface.             |
| Roster sequence             | Defect: only the initial welcome floor was ignored. Now every sequence at or below the accepted sequence is a no-op, including a newly encrypted duplicate.                                                   |
| Subscription history        | Pool subscription no longer sends `since`. Existing author filters, message sizes, queue and replay-set bounds remain. Direct welcome subscription still uses a fresh join identity.                          |
| Earlier controls            | Controls predating the authenticated welcome are ignored. Current controls still need the creator authority, appropriate phase, matching round/seat, and all existing validation. Rosters use their sequence. |

The boundary deliberately does not convert arbitrary exceptions into success.
`IgnoredEnvelope` is limited to unauthenticated, misrouted, malformed or repeated
envelopes. Closed sessions and resource limits remain errors. Valid current
rosters still require all ownership and fresh chain checks. Current blind
signatures, outputs, fees and spending signatures retain their checks. Membership
signatures are relevant only after review of the current transaction. No automatic
vote, signing, broadcasting or wallet-operation retry is added.

The existing native startup self-test previously required replay to throw. It now
requires the complete session and journal to remain identical, with no new
storage/chain work and unchanged encrypted persisted state. This checks the
upstream-required no-op behavior without dropping the replay safety invariant.

## Reproduction

The new replay test re-envelops public Kotlin fixture payloads using a known
disposable creator key. The pool key, seat proofs and coin data are unchanged.
Twelve combinations cover both script types, 2/5 participants and 1/2/5 outputs.
Old rosters, unrelated member requests, malformed plaintext, duplicates, a
newly encrypted duplicate sequence, and unrelated-round messages surround the
actual roster and vote. These fail on the parent source and pass after correction.
An initial discarded test used the wrong fixture decryption key; its failure is
not counted as evidence. The retained baseline uses the corrected fixture.

The full-client matrix also covers early welcome before join ACK, both delivery
orders, actual encrypted vault calls through native doubles, and a creator seat
whose ownership proof uses the pool key. It checks that only join is published,
no error appears, and reservations stay intact. All fixtures use public test keys
and synthetic coins, with no real network or funds.

```sh
REDWALLET_HERMES_DIAGNOSTIC=replay node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/replay.js
"$REDWALLET_HERMES_BIN" /tmp/replay.js
```

Set `REDWALLET_ESBUILD_MODULE` to the temporary esbuild installation. The optional
full baseline SHA argument substitutes only `session.ts` and `messages.ts` from
that commit; other diagnostics retain their original module substitution.
The 24 actual-Hermes cases cover both replay orders and additionally require a
substituted creator-seat proof to fail without changing accepted state.

The engine is the app-pinned `hermes-v250829098.0.10`, built for Linux. This is
not a native iOS, Keychain, live relay, signed-round or TestFlight receipt.
The exact physical-phone trigger remains unproven. See the committed release
evidence JSON for observed counts, logs and hashes.
