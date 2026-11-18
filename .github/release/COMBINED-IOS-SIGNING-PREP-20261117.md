# Combined Lightning and hardware iOS signing preparation

The protected signing and upload jobs use PR266 commit `0b79a9319849ab8553fbea5c0e72e12cbb240e83`. The production source has 1,160 tracked paths and SHA-256 `63aaec3f0346c608a0a2d380fca6687ecd23123e7dbfd764c61df33918702614`. The source verifier includes tracked modes, object IDs and paths, excluding `.github/`, `tests/`, `fastlane/metadata/`, `zapstore.yaml` and Markdown.

All five required GitHub Actions runs completed successfully on attempt 1 for this source. The release verifier checked the named jobs against GitHub on November 18 at 03:08 UTC.

| Qualification | Run |
| --- | --- |
| Software unit tests and lint | [44213350929](https://github.com/romanmodin/RedWallet/actions/runs/44213350929) |
| General iOS build and UI tests, including all seven TLS scenarios | [44213350938](https://github.com/romanmodin/RedWallet/actions/runs/44213350938) |
| Native iOS fee bump | [44213351015](https://github.com/romanmodin/RedWallet/actions/runs/44213351015) |
| Embedded LND wallet, payments, public sync, Tor smoke and standalone Tor fee regression | [44213351004](https://github.com/romanmodin/RedWallet/actions/runs/44213351004) |
| Hardware build and simulator signing flow | [44213351045](https://github.com/romanmodin/RedWallet/actions/runs/44213351045) |

The native hardware and fee-bump evidence archives matched their published SHA-256 digests. The hardware job passed three host tests and one simulator flow. The candidate includes the Settings lifecycle guard from PR270, the Tor recovery changes from PR271/272, the local malformed-transaction check from `875f84b`, and the expired bridge-quote cleanup from `42833cb`. The candidate's Android E2E job stopped before starting its suites because its runner was absent. The Android workflow fix is tracked in [PR274](https://github.com/romanmodin/RedWallet/pull/274).

Signing takes place through the protected workflow on `main` with upload disabled. Verify the signing run, signed IPA receipt, build number and encrypted artifact. For upload, pass that run ID to the same workflow on the approved orchestration commit. The uploader independently verifies the IPA and current qualification jobs and compares them with the original signing receipt before invoking Fastlane. The upload job checks the signing attempt for a successful build and a skipped upload. Its receipt records both run IDs and attempts. Twenty-two offline tests cover the release policy, source run and signing handoff.

Tester distribution needs the actual new signed and uploaded receipts. Update the historical distribution pins and verify both protected runs, Tor/fee/hardware gates, the Apple build identity and tester-group availability before reporting delivery.

Standard hardware transaction signing remains disabled. The nonspendable hardware check has simulator coverage. Physical iPhone camera and Keystone interoperability, the reported iPhone Settings-exit crash and a live bridge payment each require separate evidence. A real payment requires explicit authorization.
