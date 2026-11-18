# Combined Lightning and hardware iOS signing preparation

## Qualification update — 2026-11-18 UTC

PR266 has advanced to `0b79a9319849ab8553fbea5c0e72e12cbb240e83`. The source, production map and run pins below are historical preparation values and DO NOT authorize this newer candidate. Repin both signing and upload only after its exact-source qualification completes.

The protected signing policy now also explicitly requires the standalone `tor-fee-unit` job. Missing, skipped, failed, canceled or incomplete jobs cannot satisfy this requirement, even if the enclosing workflow is green. Twelve offline release-policy tests and four source-run tests pass. This change touches release preparation only; the app candidate and its running CI are unchanged.

Before distribution, update the historical uploaded-beta verifier from the actual new signed/upload receipts and enforce parity with the Tor smoke, Tor fee-unit and hardware gates. No new signing, upload or downloadable evidence exists yet. Preserve all protected environments and package checks.

Protected signing and upload are pinned to PR266 source `875f84bcf19fb7c98620df282d171cc344e9b3c3`. Standard hardware transaction signing stays disabled (`STANDARD_HARDWARE_RELEASE_ENABLED = false`). The offline hardware check uses a nonspendable request.

The production map has 1,158 paths and SHA256 `d519095f6edf9d46e26e90adaa6ef0895d4a631aaa8c8fcf861c3d1e83574b4e`. It includes tracked modes, object IDs and paths, excluding `.github/`, `tests/`, `fastlane/metadata/`, `zapstore.yaml` and Markdown. This verifies source identity, not reproducible binaries.

Both signing and upload require successful, completed runs on this exact source:

| Gate | Run |
| --- | --- |
| Unit and lint | 44109439778 |
| General iOS build and test | 44109439849 |
| Native BIP84 fee bump | 44109439995 |
| Embedded LND wallet, payment, public sync and Tor smoke | 44109440202 |
| Hardware build and complete simulator signing flow | 44109440144 |

These replacement runs were queued or in progress when the pins were updated. A missing, skipped, failed, canceled or still-running required job blocks signing and upload, even when the enclosing run reports success. Results for another source, workflow or repository are rejected. Jobs are read from the explicit latest run attempt. Hardware and Tor requirements remain enabled in both protected jobs.

Source 875f84b fixes Settings → Broadcast waiting on Electrum before rejecting malformed input. It validates complete hex bytes and parses the transaction locally before networking, then reuses the parsed transaction for its displayed txid. The real-screen regression suite fails seven malformed-input cases on source244 and passes all twelve cases with the fix. TypeScript and changed-file lint passed. The iOS assertion now requires the local error message without relaxing timeouts. The retained prior iOS attempt2 artifact14320909231 has SHA256 `6a0faf56b31d4e415c62f452f34a0f1f90790d3c4e04cc0247a6ac8d2b3c774a`; its screenshot shows invalid input stuck Pending. Creation and both watch-only import cases passed in that attempt. Prior passing source244 gates are historical evidence and do not qualify this changed app.

Ten offline release-policy tests and four source-run tests cover hardware/Tor job requirements, wrong source/workflow/repository, incomplete runs, invalid flags and receipt creation. Existing main-only dispatch, protected environments, read-only certificate provisioning, encrypted IPA artifacts and signed-package verification stay intact.

This preparation has not signed or uploaded an app. After every exact-source gate passes and this preparation is reviewed and merged, build with upload disabled, verify the signed package and receipt, then upload that verified artifact in a separate protected run. Distribution must be pinned to the actual new build/upload receipt; the existing distribution workflow still refers to an older build.

Simulator host signing and incoming text injection do not qualify the physical iPhone camera or Keystone 3 Pro / Cypherpunk 3.0.2 / Sparrow-mode round trip. That device test remains outstanding. No real funds have been spent. A real bridge payment needs separate authorization. The independently reported Lightning Settings-exit crash remains under investigation in PR258.
