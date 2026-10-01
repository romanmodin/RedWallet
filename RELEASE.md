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

Pull requests run unsigned simulator and unit/UI checks. The **Approved iOS
Release** workflow is manual-only and accepts the reviewed `main` commit.
Signing and upload run behind separate environments with required owner review
and deployment restricted to `main`. Keep signing and upload secrets in their
respective environments; remove repository-level copies after rotation so a
PR-controlled workflow cannot request them directly.

| Environment | Secrets |
| --- | --- |
| `ios-signing` | `APPLE_ID`, `TEAM_ID`, `ITC_TEAM_NAME`, `GIT_URL`, `GIT_PRIVATE_KEY_CONTENT`, `MATCH_PASSWORD`, `KEYCHAIN_PASSWORD` |
| `ios-upload` | `APPLE_ID`, `TEAM_ID`, `ITC_TEAM_NAME`, `APP_STORE_CONNECT_API_KEY_CONTENT` |
| `ios-signing-bootstrap` | Separately approved maintenance only; write deploy key and any certificate-management API credential |

The normal Match deploy key must be read-only at the signing repository,
independently of Fastlane's `readonly: true` setting. Normal builds install
existing certificates/profiles without App Store Connect authentication.
Certificate creation and storage updates belong in a separately approved
bootstrap operation; there is no bootstrap option in the release workflow.

## Build and upload

1. Review the exact `main` source revision, then dispatch **Approved iOS
   Release** with `upload_to_testflight=false`. Approve the signing environment
   for that revision after checking source and workflow changes.
2. The macOS verifier requires an Apple certificate from the configured team,
   verifies each app/extension identifier and profile-authorized leaf
   certificate, and checks entitlements and arm64 architecture. It emits an IPA
   SHA-256 receipt tied to the source commit.
3. To upload the same package, dispatch on the same commit with its successful
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
