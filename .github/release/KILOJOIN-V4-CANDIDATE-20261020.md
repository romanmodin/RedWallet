# Combined CoinJoin repair and v4 candidate

Based on PR73 da26261b0: same-pool unsigned retry identity and isolated encrypted session vaults; original real-device relay failure remains unidentified. This branch combines that correction with v4 development, not a separate v3 release.

Upstream: Kilombino/kilojoin commit 9a073beb7e8f5e59966fcd1a0641fa7e012d68cb, PROTOCOL.md section12 and vectors.json. Apache-2.0 attribution retained in class/xbt/kilojoin/UPSTREAM-NOTICE and UPSTREAM-LICENSE.

Implemented: multiplicity-aware fees/change/canonical transaction and every-own-output review; version/count validation; multi-output blind requests and ordered MAC, signature arrays, independent randomized publication times and fresh identities; encrypted output state redacted from UI; durable fresh receive-index reservations; timer continuation; mixed-output labeling; pool multiplicity display. Signed/uncertain reservations remain protected.

V4_ENABLED is true in this candidate; release remains gated on the required exact-source software and iOS qualification. V3 remains supported. No v4 release, real-fund join, or full native/mixed-peer interoperability claim. Remaining: combined live join diagnosis; real loopback transport/recovery timing fault coverage; mixed-implementation disposable regtest; fresh native UI/Keychain/secure entropy qualification; final enabling commit and exact-source qualification before signing/upload.

## Prior iOS failure evidence

General run39337286553 on da26261b0 failed; it is not a pass. Retained e2e-ios-videos artifact12233237443 ZIP SHA256e113617bde060488ff006f348cb34fcac6a42de2380fe65f0ee0829620f1d6a5. First self-test Keychain clear succeeded23:56:54Z, subsequent simctl termination reported NSPOSIXErrorDomain64/SpringBoard probably crashed23:56:59Z and stalled until00:06:43Z. Test exceeded600000ms before self-test completion; next test overlapped pending driver activity. Later app-container/screenshot failures followed. No CoinJoin signing defect established by this failure.

Candidate test-only setup stops app before clearing Keychain, restarts only the selected disposable iOS simulator, waits bounded boot completion, then runs the same reinstall and unchanged self-test. No timeout extension or removed assertion; no retry on failed reset. Three helper regressions pass. Hosted proof still required.

## Local candidate verification

Full regression: 116 suites, 1065 passing tests, one inherited skip. Full lint and TypeScript passed with zero errors and 19 existing warnings. Additional simulator helper checks: three passing tests; ESLint and diff checks passed after limiting reset to the first self-test only. Logs: /tmp/redwallet-v4-full-unit.log and /tmp/redwallet-v4-full-lint.log. These results are software checks, not native-device or mixed-implementation acceptance.

## Combined peer/node evidence and join correction

The initial actual loopback relay replayed authenticated rosters from before the
participant joined. This reproduced `Invalid or replayed roster sequence` for v3
and v4. The participant now ignores only sequence numbers at or below the welcome
floor. New/current roster replay, ownership and backend checks remain unchanged;
regressions verify that old history cannot replace the current roster or unlock coins.
This is a reproduced joining defect, not proof of the original physical-phone cause.

After correction and fixing the test adapter's outbound socket wiring, all six
Kilowallet1.2.0/RedWallet cases passed with real loopback sockets and isolated Knots:
one/two/five outputs on P2WPKH/P2TR, byte-identical transactions, one separate output
socket per output, node acceptance and one mined confirmation. Initial actual
receipt `/tmp/redwallet-v4-peer-regtest-receipt.json` SHA256
4a429324e13319e8223cf046c98aacf814e477d3334efe6194c6273f07a38ceb.
The exact committed replacement will be rerun and recorded independently.
Native self-test now covers five independent blinded outputs, the public RFC9474
signature vector, native entropy and Keychain-backed encrypted state/tamper rejection.
Signing review shows the output count/denomination/total, unmixed change and exact fee.

## Current iOS rotation evidence

General39411162293 failed landscape observation; full subsequent suites did not run.
Artifact12261593401 SHA256cbfb36570f9c37770144232a14fcab6bd4e4b1153eec2af791c942c4ae06fd35
retained locally. Device log records orientation request11:42:28.413Z and timeout
11:42:32.841Z; native bounds stayed402x874. Driver permits one harmless repeat only
after two stable wrong-orientation observations and at least5seconds, before10seconds;
both attempts share the unchanged15second settling budget. No orientation assertion
was removed. Local positive/negative retry-boundary tests pass; new hosted proof required.

## Apple replacement authorization and current state

User explicitly authorized TestFlight delivery and replacing the Apple submission with
v4 on2026-10-20. Read-only inspect39417792914 SUCCESS confirms old1792439689 remains
VALID/WAITING_FOR_REVIEW at11:50:55Z. Artifact12262600104 SHA256
3ddca3468076a1768780a13e1a44fcaa032cf35e38b34209ec6fc8bfa717cd25.
Do not withdraw the old submission before the new qualified IPA is uploaded, processed
and ready. Preserve existing protected environments, source/IPA checks and tester groups.
No new upload, distribution, withdrawal, or submission is represented by this candidate.

Full combined local regression passed117suites/1071tests with one inherited skip; full TypeScript/lint passed0errors/19existingwarnings. Final enabling change is separately checked by focused protocol/UI tests and required hosted exact-source gates.
