# RC7 review and TestFlight preparation

Prepared November 17, 2026. This is a draft package. It does not activate beta notes, alter privacy answers, replace a build or remove an Apple review.

## Exact candidate and evidence

- Publisher app source: `3f5beee29cfbbd257a5d967f6d2e505bfec4c1b3`; tree `212a9bc56aa9cbd93aed819fccf311a637c620c7`.
- App PR: https://github.com/romanmodin/kilowallet-ios/pull/18
- Upstream RC7: `bfc80bdff0516608daa778e0936627bd4342d7f4`. Upstream unsigned IPA SHA256 `b8407108f4c477d1008b2d3a890ab0fd45697215d8ea8aa309ce87f292e6983b`; archive SHA256 `a65da684b05a1b12a0f7fed142b689e1bbaf892c5fd052e725859369fd91cd60`. These are intake checks, not publisher signing receipts.
- Current-source local tests: 9 RPC + 106 desktop application + 4 historical 0.4.0 migration + 4 historical 0.4.1 migration = 123 passed, zero skips/failures/errors.
- Local receipt: `/home/roman_modin/kilowallet-release-evidence/rc7-rpc-review-20261117/local-qualification.json`, SHA256 `b232b22ede3dd98740926eb93ee8b63298f740294001851f0cf5d06cc7e839f4`. It explicitly does not approve native qualification or signing.
- Gitar review dashboard https://github.com/romanmodin/kilowallet-ios/pull/18#issuecomment-6945265199 approved at 2026-11-17T10:23:24Z, 4/4 findings closed. Automated review is not a substitute for native qualification.
- Exact-source native run: https://github.com/romanmodin/kilowallet-ios/actions/runs/44063853758 attempt 1 passed: 548 tests passed, one optional live test skipped, eight runtime checks and arm64 Release build passed. The protected verifier independently confirmed checkout 3aaf6d907dfc2ddf5c7516cb9685bbe7f299833c has exactly the candidate tree. Native receipt SHA256 b8d2425f0a5bb9e8ce9799d8e822d21dc5f800480a68ee81636ca45696b6b981.
- Startup visual supplement https://github.com/romanmodin/kilowallet-ios/actions/runs/44103548176 passed and was manually reviewed. Product app/core/Swift/engine trees equal the candidate; only the diagnostic workflow/runner differ. It passed first OCR without invoking the foreground retry, so no root-cause/fix claim is made.
- Missing exact-source screenshot-checker gate dispatched once: https://github.com/romanmodin/kilowallet-ios/actions/runs/44111397016 . RPC visual diagnostic44109729393 remains in progress. Neither diagnostic can replace full native qualification.
- RC7_SIGNING_PREPARATION.json records exact receipts and explicit unresolved gates. Signing workflow inputs are prepared locally for RC7, but its existing RC6 visual gate still rejects RC7 until the reviewed RC7 gate is completed. Do not merge/dispatch this preparation as ready.

## RC7 privacy delta to reconcile before release

| Data or action | Source behavior | Required disclosure |
| --- | --- | --- |
| RPC login and endpoint list | Small secret stored through the iOS Keychain bridge; device-only after first unlock, without a separate Face ID requirement | Explain local credential storage and transmission to the user-selected node; do not claim every access requires biometrics |
| Public descriptors | NodeRpcBackend.ensureWallet creates/loads a watch-only node wallet and imports receive/change descriptors | The selected node learns public wallet information and can associate address activity; private spending keys are not imported |
| Network transport | NodeRpcBackend.call refuses untrusted/changed HTTPS pins before the RPC request; local/onion HTTP is permitted; IosPlatform.openRpc routes onion via Tor | Describe transport limits; do not claim all RPC traffic uses TLS or all app services use Tor |
| Camera | RPC panel uses local QR scanning | Explain local camera purpose; never include actual credentials in review examples |
| Existing services and exports | RPC changes the on-chain backend, not Kilojoin/JoinBlaket Electrum or optional bridge/Ark behavior | Retain RC6 service/export disclosures; do not replace them with a blanket "nothing leaves the device" assertion |

Source references at the exact candidate: `core/src/commonMain/kotlin/com/kilombino/kilowallet/core/chain/NodeRpc.kt`; `app/src/commonMain/kotlin/com/kilombino/kilowallet/app/ui/NodeRpcPanel.kt`; `app/src/iosMain/kotlin/com/kilombino/kilowallet/app/IosBridge.kt`; `IosPlatform.kt`; `iosApp/iosApp/Bridge.swift`.

This table is factual preparation, not an export-compliance determination or a legal attestation. Reconcile live App Store privacy fields against exact implementation and service behavior before changing them.

## Ordered activation gates

1. Finish current-source native tests, simulator runtime probes and unsigned Release build. Inspect current-attempt reports and screenshots, including new RPC/error states. Retain run IDs, exact source/tree and artifact digests. A green run on the prior source cannot qualify this candidate.
2. Reconcile migration, LND call coverage, identity/address-progress preservation, scoped Ark/LND backups and pending/frozen guards. Use synthetic wallets only. No funded-channel/device-payment success is asserted.
3. Inspect current publisher/coordinator branches, healthy jobs and Apple build list for duplicates. Assign a new build number only from that live state; this draft intentionally assigns none.
4. Prepare the existing protected signing workflow with exact qualified source/unsigned artifact receipts. Preserve publisher identity, entitlements and engine pins. Collect signed IPA/archive SHA256, signing/upload run/attempt and Apple build UUID/processing result.
5. Update the beta notes from RC7_BETA_NOTES_DRAFT.txt with the actual build number and verified results. Qualify both intended Internal and Public Beta groups against that exact UUID, external beta approval and installability. Public invitation: https://testflight.apple.com/join/kRWKx2Xc . The invitation alone does not prove RC7 availability.
6. Tell Roman when the exact RC7 build is installable. Only then advance the separately authorized App Store replacement with accurate review/privacy metadata and supported screenshots.
7. Re-read the live App Store state before deciding how to replace or release. Build 21 was WAITING_FOR_REVIEW at 2026-11-17T14:59:15.819Z; preserve that review until replacement qualification. Never automatically delete a public version, withdraw another app, accept new agreements or make unsupported legal attestations.
8. Verify public availability before disabling the existing release-follow-up automation. Do not create another automation.

## Remaining limits

No RC7 signed upload, Apple processing, TestFlight installation eligibility, native visual approval, physical iPhone installation or real financial transaction is established by this package. RC6 1.0.0 (21) is the last verified distributed build. Current RC6 active notes and privacy URL remain in force until a qualified replacement is ready.

## Complete privacy-policy draft

RC7_PRIVACY_DRAFT.md carries forward RC6 service/export disclosures and adds the source-reviewed own-node RPC data flow, Keychain access policy, local HTTP exposure, certificate verification and remote node retention limits. It is not the active privacy URL. Reconcile existing operator statements before publication; do not silently replace the current submitted policy.
