# Combined Lightning and hardware iOS signing preparation

This orchestration candidate pins production source `244b76b823c088d2cc0e9f4c7e4ddbff1ba506bd` from PR266. It does not activate standard hardware transaction signing: `STANDARD_HARDWARE_RELEASE_ENABLED` stays false. The offline hardware check can be tested without spending funds.

The production map has 1,158 paths and SHA256 `3bc4fbba1b7f86404ba5095a980b30a2ece4fae264cbb0ac4abc2be74dbf587c`. The existing map definition includes tracked modes, object IDs and paths, excluding `.github/`, `tests/`, `fastlane/metadata/`, `zapstore.yaml` and Markdown. This verifies source identity, not reproducible binaries.

Both signing and upload require successful, completed runs on exactly the pinned source:

| Gate | Run |
| --- | --- |
| Unit and lint | 44034171626 |
| General iOS build and test | 44034171588 |
| Native BIP84 fee bump | 44033088702 |
| Embedded LND wallet, payment, public sync and Tor smoke | 44034171607 |
| Hardware build and complete simulator signing flow | 44034166335 |

These runs were still pending/in progress when this preparation was written. A missing, skipped, failed, canceled or still-running required job blocks signing and upload, even when the enclosing run reports success. A result for an older commit, another workflow or another repository is rejected. Jobs are read from the explicit latest run attempt. The hardware requirement is opt-in for this workflow, preserving unrelated workflow policies. The Tor requirement carries forward the reviewed work in PR259 without its older source pins.

The final source changes only the BIP84 test setup from a44b591: wait for the host keyboard to disappear before positioning/editing the port. The underlying app source is identical, but the exact-source release check remains strict; prior passing a44 results are not substituted. On a44, software, Android, general iOS, all embedded LND checks, and the full hardware simulator flow passed. Verified hardware receipt artifact14302788003 SHA256 `61991f835d90d9b84caf4474b0e20dfcfa1af3e8c35509c972e9f8f472646903` records a single disposable-regtest broadcast and two confirmations, QR reconstruction, signature/proof/reorg/TLS checks and cleanup.

Validation: ten offline release-policy tests and four source-run tests pass and now run in software CI. YAML parsing verifies the source pins and policy calls in both protected jobs. A read-only live check correctly refused a still-running gate. New cases exercise missing/nonpassing hardware jobs, wrong source/workflow/repository, incomplete runs, invalid flag values, and the actual command entry point with mocked APIs, requiring hardware success before writing a receipt.

The existing main-only manual-dispatch guard, protected signing/upload environments, read-only certificate provisioning, encrypted IPA artifact and signed-package verification remain in place. This branch has not signed or uploaded an app and must be reviewed before merging into main. Final run results still need verification.

Simulator host signing and incoming text injection do not qualify the physical iPhone camera or Keystone3Pro/Cypherpunk3.0.2/Sparrow-mode round trip. That device test remains outstanding; private exports stay out of GitHub/Gitar. No real funds are spent. The separate settings-exit crash remains under investigation in PR258.
