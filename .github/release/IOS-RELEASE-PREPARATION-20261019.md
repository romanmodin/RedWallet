# Combined iOS release preparation — 2026-10-19

This is preparation, not an upload or App Store submission receipt.

The user deferred Android on October 18 and requested the combined iOS improvements, optional artwork skin, TestFlight delivery and App Store submission. Android results do not qualify this release.

## Frozen application source

- Public source: `dece41b5ebeed892b66c5fb3b8e1ba32dc07b8df` (combined PR51).
- Production mapping: 968 tracked production paths, SHA-256 `b087c9351883771dec81d0425bb27564c2f16b0d853f7745942f5b4503e594a3` using `verify-production-source.py`'s documented exclusions.
- Unit/lint: https://github.com/romanmodin/RedWallet/actions/runs/39182714947 — verified successful.
- iOS general: https://github.com/romanmodin/RedWallet/actions/runs/39182714863 — still running when this preparation was written.
- Funded iOS BIP84: https://github.com/romanmodin/RedWallet/actions/runs/39182714902 — still running when this preparation was written.

The protected signing/upload workflow now pins the public application commit directly. It no longer needs a private source copy or source-read deploy key. Existing signing/upload environments, encrypted IPA handling and signed-package verification remain. Both jobs independently reject wrong-source, wrong-repository, wrong-workflow, pending, failed, skipped or missing required gate jobs. Qualification uses the run's current attempt and is included in the IPA receipt. Fixture validation accepted a successful gate and rejected seven invalid-source/status/job/fork cases. YAML and shell syntax checks passed.

The capture-only workflow reuses the qualified simulator artifact, validates all three gates and records screenshot hashes and dimensions for iPhone/iPad. Its demo wallet is freshly generated and empty. Only explicit wallet/receive/artwork/recovery-options screenshots are saved; seed-screen capture, videos, automatic failure screenshots and hierarchy capture are disabled. No fake balance, private user wallet, or production-node interaction is used. These are simulator screenshots, not physical-device acceptance.

## App Store draft work

Live App Store Connect app `6817118871` is RedWallet XBT. Finance category and subtitle `Self-custody for XBT` saved. Content questionnaire completed with Apple's calculated 4+ age rating (regional variations); it is not categorized Made for Kids. Free pricing saved with the United States as base. Standard worldwide availability saved for release, not released now.

Still required before submission: successful exact-source iOS gates; merge app and orchestration; signed build and verified upload/Apple processing; actual reviewed screenshots; privacy policy publication and data-disclosure completion; content-rights declaration; appropriate review access/instructions; current build selection and version alignment. Existing TestFlight 8.0.1(1791526289) is older and must not be submitted as the combined candidate. No release/submission receipt exists for the new candidate yet.
