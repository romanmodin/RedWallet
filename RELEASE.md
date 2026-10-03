# RedWallet iPhone beta release

The source and simulator build are not an installable TestFlight release.
Keep the development PR in draft until the applicable gates below pass.
See XBT_VALIDATION.md for recorded results and their limits.

## Apple setup

1. Wait for the paid membership to activate. A confirmed purchase with a
   pending membership is not a reason to pay again.
2. Verify the intended developer team and enrollment type. Organization
   enrollment is required for the cryptocurrency wallet release under Apple's
   wallet guideline. An individual membership can request conversion through
   Apple Developer Support after the organization's details are available.
3. Register these bundle IDs on that team:
   - Main app: `com.romanmodin.redwallet`
   - Embedded sticker extension: `com.romanmodin.redwallet.Stickers`
4. Review the release entitlements against the registered identifiers before
   generating profiles. Watch and Widgets are outside the initial release.
5. Create the RedWallet app record in App Store Connect using the main bundle
   ID. Record the correct Developer team ID and App Store Connect team ID;
   never borrow another team's identifiers just because that team is visible.
6. Arrange an App Store Connect API key with the access required for the
   chosen signing/upload operations and a private Match repository for
   encrypted certificates/profiles. Creating these credentials and granting
   access must be explicitly authorized; do not place keys in source, chat,
   screenshots, logs, or public artifacts.

## Apple setup checkpoint (2026-09-28)

- Paid individual membership is active; organization conversion remains pending.
- Main and sticker bundle IDs above are registered on the intended owner team.
- `group.com.romanmodin.redwallet` is registered and assigned to the main app.
- App Store Connect record created as **RedWallet XBT** (Apple app ID
  `6817118871`, SKU `redwallet-ios`). The shorter store name was unavailable.
  The device display name remains RedWallet.
- Apple API access and the App Manager build key were approved by the owner.
  The key is stored in the app repository's encrypted Actions secrets.
  Distribution signing material was created successfully by the release workflow.
- Signing secrets and a private Match repository are configured. Its deploy
  key can access only that repository. The signed IPA passed signature, profile,
  entitlement, bundle identity and architecture verification. Apple processed
  version 8.0.1 (1790631720), and the Roman iPhone Testing group now contains
  one build and the invited owner account. Automatic distribution remains off.

## First owner device-testing checkpoint (2026-09-28)

- Signed source: `af92c80f3cf58a3d65fec870296280e133c05dd2`.
- Native release run: `36487156965`; verification run: `36489720701`;
  successful upload run: `36489908219`.
- IPA SHA-256: `f9ae1b813d4216d7590426b74cab7cc9befb7ac1388ac2e5917a49fa638596b2`.
- App Store Connect confirmed upload Complete, group assignment, and owner
  Invited. This makes an initial physical-device smoke test possible.
- Unit/lint checks passed (602 unit tests passed, one skipped); Android UI
  run `36482992432` passed. iOS UI run `36482992401` remains in progress at
  this checkpoint and must not be reported as passing.
- The actual app adapter connected to the owner's home-LAN Fulcrum and passed
  the pinned XBT checkpoint check. The laptop was not on the tailnet, so its
  failed tailnet attempt does not validate or invalidate the phone VPN path.
- Start physical testing with an empty disposable wallet: launch, create,
  receive address/QR, restart persistence, recovery and server settings.
  Do not treat installability as completion of the readiness gates below;
  combined spend/broadcast/confirmation and physical-device checks remain open.

## GitHub Actions configuration

Pull requests run unsigned simulator and unit/UI checks. The old signed PR
workflow is disabled. **Build approved private iOS source** is manual-only on
`main` and pins a reviewed commit in the private native-source repository.
Actions are disabled in that source repository. The public workflow contains
release orchestration; tester packages are encrypted before public artifact
storage and authenticated against the source commit, workflow commit, and run.
Signing and upload run behind separate environments with required owner review
and deployment restricted to `main`. Keep signing and upload secrets in their
respective environments; remove repository-level copies after rotation so a
PR-controlled workflow cannot request them directly.

| Environment | Secrets |
| --- | --- |
| `ios-signing` | `APPLE_ID`, `TEAM_ID`, `GIT_URL`, `GIT_PRIVATE_KEY_CONTENT`, `MATCH_PASSWORD`, `KEYCHAIN_PASSWORD`, `SOURCE_READONLY_DEPLOY_KEY`, `IPA_ARTIFACT_KEY` |
| `ios-upload` | `APPLE_ID`, `TEAM_ID`, `APP_STORE_CONNECT_API_KEY_CONTENT`, `SOURCE_READONLY_DEPLOY_KEY`, `IPA_ARTIFACT_KEY` |
| `ios-signing-bootstrap` | Separately approved maintenance only; write deploy key and any certificate-management API credential |

The normal Match deploy key must be read-only at the signing repository,
independently of Fastlane's `readonly: true` setting. Normal builds install
existing certificates/profiles without App Store Connect authentication.
Certificate creation and storage updates belong in a separately approved
bootstrap operation; there is no bootstrap option in the release workflow.

### Credential rotation checkpoint (2026-10-01)

- Match encryption password, signing-repository deploy keys, temporary-keychain
  password, and App Store Connect upload key were rotated. Apple confirms the
  old upload key is revoked; the replacement authenticated to the RedWallet app.
- The normal deploy key is read-only. The write key is confined to the reviewed
  bootstrap environment. Rotation preserved and reverified all four existing
  certificate/profile files; certificates were not replaced in this operation.
- Repository-level signing passwords and private keys were removed. Remaining
  repository values are account/team/repository metadata. The Apple upload key
  is stored only in `ios-upload` and is absent from the build job.
- Signing, upload, and bootstrap environments require owner review and allow
  deployments only from `main`.

### Reviewed wallet-safety tester release (2026-10-01)

- Fixed iPhone version **8.0.1 (1790892958)** is processed and available to
  both **Roman iPhone Testing** and **RedWallet Early Testers**. Apple reports
  `VALID`, beta review `APPROVED`, and `IN_BETA_TESTING` for internal and external
  access. The existing [TestFlight link](https://testflight.apple.com/join/UuExh5RP)
  remains enabled with its 20-tester limit.
- Approved private source: `fd4cedfb98fa608941c591fd2387b14b1dedfced`;
  public orchestration: `d9e3550f8cf9f90f7f8128938759fd6c0b871f11`.
  Its production app code matches the reviewed safety changes in this branch;
  later changes concern tests, documentation, and the release verifier.
- [Build run 36933275202](https://github.com/romanmodin/RedWallet/actions/runs/36933275202)
  and [upload run 36935579376](https://github.com/romanmodin/RedWallet/actions/runs/36935579376)
  completed successfully. Both receipts confirm the same IPA SHA-256:
  `1d5892bcfa024bdbc33c5af22041737033c19e2afa21abbfd63dc673c5fe0304`.
- macOS verified the signing team, both bundle identities, profile-authorized
  signing certificates, distribution entitlements, profile validity, and arm64
  architecture. The package was encrypted for artifact storage and authenticated
  against its approved source, workflow commit, and originating run before upload.
- The replacement Apple upload key completed this release after the old key
  was revoked. Signing used the read-only Match key; Apple authentication was
  confined to the separately reviewed upload job.
- All five selected simulator checks passed across the two runs recorded in
  XBT_VALIDATION.md, including recovery/restart and unsupported import rejection.
  That document records the reused simulator's source limits and the 638 passing
  unit tests. Physical iPhone QA and the complete phone/Fulcrum send flow remain
  open; this tester release does not close those gates.

### Security follow-up source and tester packages (2026-10-02–03)

- Security and pre-send quote changes from PRs #3–#7 were merged atomically
  through PR #7 at `fdb9b0e94984937647e30c5cacb11fcfd3b91368`.
  Subsequent PRs #8–#12 bring reviewed production source to
  `ead773ee0269d7dfc9ff16822fd3e760aaa33b75`. Final CI runs
  `37112045207` and `37112225121` passed; the complete unit result is
  77 suites, 708 tests passed and one skipped. TypeScript and lint passed.
  Native checks and published package receipts are recorded below.
- Approved private signing source for the inner-timeout follow-up:
  `91bc88b6e1f70f6050f55130d4a66b140c3021b8`. All 941 production entries
  (Git file mode, blob ID and path) match the public source. Production tree
  SHA-256: `05b0f3c2dc181952f74c1842882511e7f31693e9b51d064b2265e9df6f06509a`.
  The mapping excludes workflows, tests, Markdown and store metadata. It is
  source equivalence, not a claim of reproducible binary equivalence.
- Both signing and upload jobs verify the pinned production tree before
  installing dependencies. Source and IPA verification use isolated Python
  and the public orchestration scripts, never scripts from the private source.
  Package receipts include the source mapping and the IPA hash.
- These changes are included in Android beta `1791019127` and TestFlight
  `1791019257`. Signed package receipts and Apple tester availability were
  verified on October 3, 2026; see the package status below.
- Follow-up device checks include authenticated TLS after restart, rejecting
  an impostor even with the correct public checkpoint, password/decoy storage,
  native cache migration, restored history, and an XBT cold-wallet PSBT round
  trip. Physical signing compatibility and broader recovery validation
  remain open. The earlier missing-history case was resolved by the tester
  correcting their server; no app fix is claimed for it. Use disposable wallets
  for exploratory testing.
- Password storage upgrades to scrypt/AES-GCM with the identical fixed-strength
  native derivation on iOS/Android. Native self-test checks an independent
  full-cost reference; failed decoy creation preserves the active wallet.
  Secret copies on iOS are local-only and expire at the OS level. All executable coinb.in verification links are removed, including transaction
  export and CPFP/RBF review screens. The send
  confirmation includes the configured XBT price estimate below the amount.
  Earlier app versions cannot
  read upgraded storage: retain an offline recovery backup and do not downgrade.

### Native Android verification (2026-10-03)

- At public source `29211e8f6663c2fa25ad53ca3381adf9e1b15cd5`,
  [run 37104706218](https://github.com/romanmodin/RedWallet/actions/runs/37104706218)
  completed successfully: seven native TLS cases and twelve supported wallet/UI
  cases passed. Five inherited unsupported multisig/account cases were skipped.
- The run checked the full-cost UTF-8 native storage vector, password/decoy
  recovery, wallet/recovery persistence, receive QR, scanning, deletion,
  watch-only import with external signing disabled, and saved-price persistence.
- Later source `aba239ae5f2be93ee2d8f5c2e048fe4395b2b7dd` removes two web
  verification buttons/imports. Its unit/lint run `37105957233` passed with
  697 tests and one skipped. Android native run `37105957226` passed all seven
  TLS and twelve supported wallet checks. The corresponding iOS failure and
  subsequent deadline follow-up are recorded below.
- Simulator/emulator checks do not establish physical-device cache migration,
  funded spending or a particular cold signer's interoperability.

### Outer TLS connection deadline follow-up (historical, 2026-10-03)

- Source `e34407a3c98db41dec4ebd38927d08badb45dcfa` gives authenticated
  TLS connections 15 seconds for certificate evaluation; intentional TCP stays
  at 5 seconds and onion connections at 21 seconds. Authentication failures do
  not retry or fall back. Six new deadline/late-completion/authentication/chain
  regressions passed, with TypeScript and lint. Full unit/lint CI run
  `37109292569` passed: 77 suites, 703 tests and one skipped.
- The preceding sourceaba Android run `37105957226` passed all seven TLS and
  twelve supported wallet checks. Source292 iOS passed all seven TLS checks,
  then its simulator SpringBoard failed before the wallet self-test launch.
  Final sourceaba iOS run `37105957236` passed six TLS cases but rejected a
  correctly entered trusted certificate at the five-second connection deadline.
  Neither failed iOS attempt is an overall native pass.
- A fresh focused iOS run `37109350530` rechecks that trusted-certificate case
  before the complete supported wallet suite. Normal CI retains full TLS
  coverage. Test diagnostics log failures/RPC counts and retry launch once only
  for the specific simulator system-shell failure; assertions are not retried.
- Package builds `37107835911` (Android) and `37108017688` (iOS) succeeded
  for the preceding source, but remain unpublished and superseded. New tester
  packages must use this final source mapping. No new tester availability is
  claimed until the signed packages, upload and Apple processing are verified.

### Inner TLS authentication timer and package status (2026-10-03)

- Current reviewed production source: `ead773ee0269d7dfc9ff16822fd3e760aaa33b75`.
  Its 941 production entries match private source `91bc88b6e1f70f6050f55130d4a66b140c3021b8`;
  production SHA-256 `05b0f3c2dc181952f74c1842882511e7f31693e9b51d064b2265e9df6f06509a`. Trusted isolated source verification passed.
- The preceding focused iOS run `37109350530` compiled successfully but failed
  its trusted-server case with zero RPCs. The screenshot showed a genuine
  connection failure. Correct certificate, host and SSL settings were verified.
  The socket closed at the dependency's inherited five-second timer; native
  trust evaluation arrived afterward. Increasing only the outer settings timer
  was insufficient. This follow-up also aligns the patched client's inner TLS
  timer to 15 seconds (onion 21, TCP 5). Authentication still gates all RPCs,
  fails closed and never falls back. Five real-patched-client regressions passed.
- Final full unit checks: 77 suites, 708 tests passed, one skipped; TypeScript
  and lint passed. Android native run `37112045214` succeeded: all seven TLS
  and twelve supported wallet/UI checks passed, with five inherited unsupported
  cases skipped. Focused iOS run `37112205747` succeeded: the trusted-leaf
  recheck and all twelve supported wallet/UI checks passed. The other six TLS
  cases were intentionally skipped in this focused run; all seven had passed
  at source292. These are simulator/emulator results, not physical-device tests.
- Preceding source `e34407a3c98db41dec4ebd38927d08badb45dcfa` passed
  final Android run `37109292589`: seven TLS and twelve supported wallet checks,
  including the full-cost native storage vector. Package build `37109789321`
  passed release launch checks. Signed Android beta `1791016257` was published
  with the retained certificate, verified unchanged APK payload and checksum
  `b4461b116e576da996286bdc0e69fc0cd363cf24174a7ae78876a41d7b3d2080`.
  It predates the inner-timer follow-up; slow TLS still fails closed in that beta.
- Preceding iOS package run `37109790915` successfully signed and verified
  build `1791016465`, IPA SHA-256
  `5d1e2929026bf86d3510ee47228da7476071146bfa834e18f3037ca5ed60ac49`.
  It was not uploaded and is superseded by the final timer source and packages
  below. No public App Store submission was performed.

### Published security follow-up packages (2026-10-03)

- Android **8.0.1 beta 1791019127** is available from the
  [release page](https://github.com/romanmodin/RedWallet/releases/tag/android-v8.0.1-beta-1791019127).
  Build run `37112448688` succeeded at orchestration
  `ffc995fc9cf1d66092a827fef7097b6ffa5e2f57`.
  APK SHA-256: `e966c2f9594f9e1894c48bf6857fe4df07f51dc04cb83bc53c9db77ed11f438c`
  (66,325,487 bytes).
  Retained signing certificate SHA-256:
  `7843791c3cf340458fbf400a204361a0a97ac9c2902ae36c4511396f1f55884f`.
  V1/V2/V3 signature and 16 KB alignment checks passed; signed APK payload
  entries match the unsigned build. Launch was checked in an Android emulator.
  Release assets include checksums, source/build receipt and launch verification.
- iOS **8.0.1 (1791019257)** signed build `37112450847` and upload
  `37115320902` succeeded at the same orchestration revision. The upload
  independently verified the same source mapping, signatures and IPA:
  `ffa18c72450506c7d32f0f90d515754c2c9fba1a25b9b8e4809e2293f9753c5f`.
  Apple processing is `VALID`; internal and external states are both
  `IN_BETA_TESTING`. Membership of the existing Roman iPhone Testing and
  RedWallet Early Testers groups was verified. This is TestFlight availability,
  not a public App Store submission or approval.
- Both receipts identify reviewed public `ead773ee0269d7dfc9ff16822fd3e760aaa33b75`,
  private `91bc88b6e1f70f6050f55130d4a66b140c3021b8`, and the
  941-entry production hash above. This source mapping is not an independently
  reproducible binary proof.
- Four public Android screenshots were captured from the exact signed APK in
  run `37115128237`, using a newly generated empty disposable wallet and a
  manual demo quote. No recovery phrase or private-key screen was captured.
  Temporary screenshot-validation PR #13 was closed without merging.
- Physical phone/cold-wallet interoperability, native cache migration on real
  devices, and an isolated funded receive/send/confirmation/recovery flow still
  require tester validation. Independent header-chain/merkle verification,
  Taproot and multisig support remain separate work. Keep an offline backup;
  do not downgrade after upgrading encrypted storage.

## Build and upload

1. Review the pinned private source revision and the exact public `main`
   workflow revision, then dispatch **Build approved private iOS source** with
   `upload_to_testflight=false`. Approve the signing environment after checking
   both revisions. Early checks verify the pinned production source and parse the certificate
   requirement before dependency installation and compilation.
2. The macOS verifier requires an Apple certificate from the configured team,
   verifies each app/extension identifier and profile-authorized leaf
   certificate, and checks entitlements and arm64 architecture. It emits an IPA
   SHA-256 receipt tied to the source commit.
3. To upload the same encrypted package, dispatch on the same workflow commit with its successful
   `source_run_id` and `upload_to_testflight=true`. The source must be a successful
   manual release from the same repository, `main` branch and exact commit.
   Fork and PR artifacts are rejected. Approve the separate upload environment.
4. Confirm Apple's processing result, beta metadata, export compliance, tester
   access and any required Beta App Review. Upload success alone does not mean
   testers can install the package.
5. Install through TestFlight and perform the applicable device checks below.
   Simulator artifacts are for simulator tests.

## Beta readiness gates

- Supported unit and UI tests pass for the chosen revision, including
  deterministic recovery, receive-address persistence, invalid import rejection,
  wallet storage, and manual-price persistence.
- The configured XBT backend passes the fork checkpoint check; a Bitcoin
  backend is rejected without fallback.
- Complete wallet history, parent-transaction retrieval, mature spend selection,
  fee calculation, signing, broadcast, confirmation, and change are exercised
  together in an isolated environment. Existing read-only Fulcrum checks and
  regtest signer acceptance do not establish this whole flow.
- Preserve the independent Bitcoin-node rejection regression recorded in
  XBT_VALIDATION.md; the offline digest negative control is a separate check.
- Physical iPhone checks cover first launch, recovery/restart, receive QR,
  camera scanning, VPN/server access, biometric/keychain behavior, and the
  send confirmation screen. Any real-funds transfer requires the owner's
  explicit transaction authorization.
- A signed and processed build is available to the intended tester.

## Sources

- [Apple organization enrollment](https://developer.apple.com/programs/enroll/)
- [Individual-to-organization conversion](https://developer.apple.com/help/account/membership/updating-your-account-information/)
- [Apple wallet guideline](https://developer.apple.com/app-store/review/guidelines/#cryptocurrencies)
- [Fastlane Match authorization and storage](https://docs.fastlane.tools/actions/match/)
