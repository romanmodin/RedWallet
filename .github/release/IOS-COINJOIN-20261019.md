# Main-app CoinJoin inclusion — October 19, 2026

Owner request at October 18 23:02–23:03 America/New_York: include CoinJoin in the
main app, visibly distinguish it with subtle color while it remains experimental.
PR52 merged to b54e1917465eaf917959d35b059e353272943b92.

Frozen source: ad776226287682d82ef43271ec72e569e639fae4.
Production mapping: 985 paths, SHA256
7c3467a1ea80ec09b42bc6cae78fdf3f56da7b75d9e68c8689333182bf535b55.

Settings > Tools shows amber CoinJoin — Experimental. The entry screen requires
explicit opt-in; offline sample mode remains available. Signing and broadcasting
remain separate explicit actions. The reservation guard also covers the combined
main source's BIP84 replacement method. Privacy policy and beta notes were updated.
Experimental availability does not claim complete device or reconnect qualification.

Local full suite: 108 suites, 1002 passed, one inherited skipped test. Full lint and
TypeScript passed, with 19 inherited/cryptographic warnings and zero errors.

Exact-source release gates, RUNNING at preparation time:
- CI: https://github.com/romanmodin/RedWallet/actions/runs/39193337442
- General iOS: https://github.com/romanmodin/RedWallet/actions/runs/39193337710
- Funded BIP84 iOS: https://github.com/romanmodin/RedWallet/actions/runs/39193351056

Signing and screenshot workflows now pin this source and these run IDs. Existing
verify-ios-release-gates.py still requires success, correct source/repo/workflow,
current attempt and all required jobs before any signing or capture. No check is
removed or treated as passed by this preparation. Do not dispatch until all pass.

The already-running prior signing job 39192224622 and capture39192227627 target
the older dece source and do not include CoinJoin. They may finish, but their
artifacts cannot satisfy this updated release request. Do not submit that older
build for final App Review under the updated scope. No new signing dispatch occurs
in this preparation; avoid duplicate concurrent runs.

After exact-source gates pass: sign/upload the updated source, verify the actual
IPA and Apple processing, update distribution pins only from its verified receipt,
assign existing tester groups, capture/review actual screenshots and select the
correct new build. Update the published policy URL to this source's docs/PRIVACY.md
before submission because it now explains optional relay participation. Main source
inclusion is complete; delivery and Apple review are not yet claimed.
