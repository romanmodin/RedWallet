# V4 review replacement sequence

Verified Apple documentation on 2026-10-22: screenshots cannot be uploaded or edited while the version is Waiting for Review. Removing the prior submission makes this version Developer Rejected. Therefore new screenshot upload must follow a verified withdrawal; do not create a circular gate requiring the new Apple screenshot receipt before withdrawal.

Sources:
- https://developer.apple.com/help/app-review/after-submitting-for-review/review-status/
- https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review

1. Complete signing/upload run 39799087741 for frozen source 286e875cb488365eeb00799b6c04305994ab9db7. Verify actual package/source/signatures and Apple processing. Update tester distribution pins only from its actual receipt, deliver to both existing groups and verify live IN_BETA_TESTING.
2. Complete actual capture 39799093428 and inspect all eight fresh empty-wallet frames. Prepare and validate exact upload hashes and upload code before withdrawing the old review. The accepted iMessage images may be reused only with the unchanged ios/ subtree proof and successful new signed extension verification; preserve historical receipt source fields.
3. Prepare a protected withdrawal-only step with exact new package and beta receipts, successful capture provenance/visual review, and the historical current screenshot receipts. Verify the new build and TestFlight delivery, and the existing Apple listing/ten old assets immediately before the one guarded withdrawal. Never pass new capture images off as Apple COMPLETE upload receipts. If cancellation is asynchronous, retain its receipt and inspect its state; do not repeat an uncertain write.
4. After Apple confirms old review COMPLETE/CANCELED and version Developer Rejected/Prepare for Submission, upload the exact reviewed new main screenshots. Require all eight COMPLETE and retire only the known replaced old assets. Preserve accepted iMessage assets.
5. Populate the final four-receipt manifest with actual new IPA/beta/main screenshot receipts plus the unchanged iMessage source proof and historical receipt. Wire the prepared replacement/submission helper only after these real pins exist. Its preflight checks must validate all ten final Apple assets; confirm the old withdrawal or already-submitted replacement, then select the new build, update the qualified policy URL and submit. Verify actual WAITING_FOR_REVIEW/IN_REVIEW and selected build.

Local code preparation: replaceAndSubmit is exported and tested, but the CLI remains on prior receipt pins and does not call it. The replacement helper accepts Developer Rejected and the known prior selected build only after qualified-source withdrawal verification. Its client adds read-only beta detail/group endpoints. All 24 offline tests pass. No new Apple writes or new receipt IDs are asserted by this document.

Preserve the exact app/version/team, existing environment protections, encrypted IPA handling, release mode AFTER_APPROVAL, US-only/free/age4+/Mac/Vision off, legal/privacy/contact settings. Stop if Apple has approved the old release or any unrelated review/build selection appears.
