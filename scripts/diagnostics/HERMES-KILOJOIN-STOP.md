# Cancellation persistence and retry boundary

The 2026-10-23 deeper failure-injection pass found a separate cancellation
defect after the decoder correction. This does not establish why the user's
physical phone failed its first join.

`ParticipantSession.cancel` first persists the reservation journal's terminal
state, then saves the encrypted participant state. If the second write failed,
the first was already durable. Retrying cancellation called `Round.cancel`
again on an aborted unsigned journal, which correctly rejected the invalid
transition. The failed encrypted write also skipped inbox/key cleanup, so a
directly delivered late creator message could still change participant state.
The production relay closes before Stop; the late-message test deliberately
checks the controller boundary too, rather than claiming that every such
message would traverse the closed production socket.

The bounded correction skips only a journal cancellation already durably
marked aborted, then retries the encrypted terminal write. Once journal
cancellation succeeds, a finally block closes the inbox, clears pending votes
and zeroes the join secret even if encrypted storage fails. A journal write
failure still propagates before this cleanup. Signed/uncertain rounds still
use the unchanged conservative journal path and retain reservations. No
transaction action is retried, and no signing/replay/validation gate changed.

## Reproduction

The original three focused Node tests fail on parent
`63f276c75136580d94a1f9033a5ba95109fe255d`: retry after encrypted failure,
late message after durable cancellation, and repeated Stop. Two additional
tests cover concurrent Stop and encrypted cancellation failure after signing.
Four full MixingClient tests cover both script types, key-read/ciphertext-write
failure during Stop, fresh retry identities and isolation from old sockets.

For the actual Hermes engine matrix, set the bundler and engine paths as in
`HERMES-KILOJOIN-STARTUP.md` and run:

```sh
REDWALLET_HERMES_DIAGNOSTIC=stop node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/kj-stop-before.js 63f276c75136580d94a1f9033a5ba95109fe255d
REDWALLET_HERMES_DIAGNOSTIC=stop node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/kj-stop-after.js
/path/to/hermes /tmp/kj-stop-before.js > /tmp/kj-stop-before.json
/path/to/hermes /tmp/kj-stop-after.js > /tmp/kj-stop-after.json
```

The `stop` diagnostic's baseline replaces only session.ts, leaving the decoder
fix intact. The default `startup` diagnostic still replaces only crypto.ts.
The 12 public Kotlin startup fixtures cross both script types, 1/2/5 outputs
and 2/5 participants. Each runs six cancellation scenarios: repeated Stop,
concurrent Stop, encrypted-write failure, journal-write failure, Stop waiting
for welcome persistence, and Stop waiting for roster observation. Expected:
before 36 pass/36 fail, after all 72 pass. No socket, wallet, spending signer
or broadcast exists in this diagnostic. Storage and chain boundaries are
injected test implementations; this is not native iOS Keychain testing.

## Validation

The four related suites passed 92 tests after the correction. The broader
unit run passed 124 suites / 1,944 tests, with one inherited skip. Four later
full-client fault tests passed separately; they are not included in that
1,944 count. Canonical `npm run lint` passed with zero errors and 19 existing
warnings; changed files passed ESLint without warnings, and TypeScript passed.
An exploratory directory-wide lint included vendor/generated paths outside
the repository's canonical lint command and reported existing errors; it was
not used as the release gate or fixed by changing unrelated files.

Actual results and hashes are retained in
`.github/release/IOS-KILOJOIN-STOP-PERSISTENCE-20261023.json`.
No native iOS, new TestFlight or App Review receipt is implied by these tests.
