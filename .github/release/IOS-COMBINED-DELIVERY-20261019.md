# Combined iOS beta delivery preparation — October 19, 2026

The prior beta-assignment workflow pinned October 9 build 1791526289. This change pins the actual signed combined update, including optional artwork and experimental opt-in CoinJoin, to build **1792401003** (version 8.0.1).

- App source: `0e36e37ad797b13b711d2606b52ac70ea52e873f`.
- Release orchestration: `5403dd29ebf2dc78b3b6b8431b6b75ad97fbd0c5`.
- Production mapping: 985 paths, SHA-256 `4fe2b1a5a4619f002d7b7cc19781d7fcee5b182f16de19cb831e63f172893f63`.
- Signed IPA SHA-256: `51709825f93f4287eff276e92151924cadf32e80d124994b90e1e114a93ba0e7`.
- Release/upload run: https://github.com/romanmodin/RedWallet/actions/runs/39222335480 . Build job passed; upload-stage package receipt artifact `12178205106` is retained as `IOS-COMBINED-IPA-20261019.json`.
- CI https://github.com/romanmodin/RedWallet/actions/runs/39206955313 , general iOS https://github.com/romanmodin/RedWallet/actions/runs/39206955356 , and funded iOS https://github.com/romanmodin/RedWallet/actions/runs/39206955341 passed on the exact app source.

At 09:43 UTC, Apple displayed build 1792401003 as **Processing**. This is evidence of receipt by Apple, not tester availability or App Review submission. Distribution must wait for the successful upload workflow and its required current-attempt jobs. The verifier reuses the exact-source gate validator and requires the package qualification receipt to match current gate attempts.

Both existing tester groups remain the only delivery targets. Apple processing, app/group identity, encryption compliance, idempotency, beta-review state, and actual availability checks remain enforced. Beta notes use `combined-ios-beta-notes.txt`. No app source or release-environment protection changes are included.

Four real fresh-empty-wallet screenshots per iPhone and iPad from capture run https://github.com/romanmodin/RedWallet/actions/runs/39222338489 were uploaded through App Store Connect. Apple showed 4/10 for each native size; the required medium iPhone panel reuses the large iPhone assets. The saved policy URL now points to the qualified app source. Reviewer notes already include experimental CoinJoin and Kilombino attribution. Final build selection, tester delivery, and App Review submission still require verified completion.

Hosted checks and screenshots do not establish physical-phone or ColdWallet interoperability. Android remains deferred.
