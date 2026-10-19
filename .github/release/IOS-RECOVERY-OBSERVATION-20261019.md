# iOS recovery observation correction — 2026-10-19

Funded run https://github.com/romanmodin/RedWallet/actions/runs/39200157419
on source 823470d7fae4b7d12d3bc3e90e242f528a8ce80f failed before send/RBF.
The RecoveryStopButton native wait requested 90 seconds but remained unanswered
until the 900-second Jest case expired. Retained screenshot shows discovery
still scanning Native SegWit account 1 change 20; this does not establish why
recovery stopped advancing or prove an app defect. No success receipt exists.

Evidence: artifact 12166005088, retained at
/tmp/redwallet-funded-evidence-39200157419; log
/tmp/redwallet-funded-failure-39200157419.log. The previous source's funded pass
cannot qualify this source.

Replace only the native long wait with driver-side read-only assertions under
the same 90-second overall budget. An unanswered individual observation fails
in 10 seconds without another request, allowing existing catch/finally to retain
diagnostics and stop the isolated backend. No taps, signing, broadcast or deletion
are retried. The incomplete-scan rejection, import, balance, decoded fee review,
fee-bump and Knots acceptance assertions remain. No production code change.

Focused unit checks verify success, pending observations, persistent false
conditions, hung requests, the remaining deadline and timer cleanup. They prove
driver behavior only. Required exact-source unit/lint, general iOS and funded
native iOS still must pass before release qualification. No upload or submission.

Local validation: 2 focused suites / 13 tests passed; full TypeScript and lint
passed with 0 errors and 19 existing warnings. Logs: /tmp/redwallet-recovery-
observation-unit-final-20261019.log and /tmp/redwallet-recovery-observation-lint-20261019.log.
