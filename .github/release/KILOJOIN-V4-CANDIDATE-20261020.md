# Combined CoinJoin repair and v4 candidate

Based on PR73 da26261b0: same-pool unsigned retry identity and isolated encrypted session vaults; original real-device relay failure remains unidentified. This branch combines that correction with v4 development, not a separate v3 release.

Upstream: Kilombino/kilojoin commit 9a073beb7e8f5e59966fcd1a0641fa7e012d68cb, PROTOCOL.md section12 and vectors.json. Apache-2.0 attribution retained in class/xbt/kilojoin/UPSTREAM-NOTICE and UPSTREAM-LICENSE.

Implemented: multiplicity-aware fees/change/canonical transaction and every-own-output review; version/count validation; multi-output blind requests and ordered MAC, signature arrays, independent randomized publication times and fresh identities; encrypted output state redacted from UI; durable fresh receive-index reservations; timer continuation; mixed-output labeling; pool multiplicity display. Signed/uncertain reservations remain protected.

V4_ENABLED remains false pending qualification. V3 remains supported. No v4 release, real-fund join, or full native/mixed-peer interoperability claim. Remaining: combined live join diagnosis; real loopback transport/recovery timing fault coverage; mixed-implementation disposable regtest; fresh native UI/Keychain/secure entropy qualification; final enabling commit and exact-source qualification before signing/upload.

## Prior iOS failure evidence

General run39337286553 on da26261b0 failed; it is not a pass. Retained e2e-ios-videos artifact12233237443 ZIP SHA256e113617bde060488ff006f348cb34fcac6a42de2380fe65f0ee0829620f1d6a5. First self-test Keychain clear succeeded23:56:54Z, subsequent simctl termination reported NSPOSIXErrorDomain64/SpringBoard probably crashed23:56:59Z and stalled until00:06:43Z. Test exceeded600000ms before self-test completion; next test overlapped pending driver activity. Later app-container/screenshot failures followed. No CoinJoin signing defect established by this failure.

Candidate test-only setup stops app before clearing Keychain, restarts only the selected disposable iOS simulator, waits bounded boot completion, then runs the same reinstall and unchanged self-test. No timeout extension or removed assertion; no retry on failed reset. Three helper regressions pass. Hosted proof still required.

## Local candidate verification

Full regression: 116 suites, 1065 passing tests, one inherited skip. Full lint and TypeScript passed with zero errors and 19 existing warnings. Additional simulator helper checks: three passing tests; ESLint and diff checks passed after limiting reset to the first self-test only. Logs: /tmp/redwallet-v4-full-unit.log and /tmp/redwallet-v4-full-lint.log. These results are software checks, not native-device or mixed-implementation acceptance.
