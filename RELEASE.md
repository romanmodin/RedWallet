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

The iOS release workflow uses these repository secrets:

| Secret | Expected value |
| --- | --- |
| `APPLE_ID` | Apple Account email for the selected team |
| `TEAM_ID` | Apple Developer team ID |
| `ITC_TEAM_NAME` | Exact selected team name |
| `GIT_URL` | SSH URL of the private Match signing repository |
| `GIT_PRIVATE_KEY_CONTENT` | Deploy private key restricted to the signing repository |
| `MATCH_PASSWORD` | Password encrypting the Match repository |
| `KEYCHAIN_PASSWORD` | Temporary build-keychain password |
| `APP_STORE_CONNECT_API_KEY_CONTENT` | Fastlane API-key JSON with `key_id`, `issuer_id`, and PEM `key` content |

Initialize the Match repository's `main` branch before using
`clone_branch_directly`. Restrict its credential to that repository.
A normal build uses existing profiles in read-only mode. A bootstrap run with
`create_signing_material=true` can create certificates/profiles and write them
to the encrypted signing repository; use it only after those changes have
been authorized. The workflow checks missing configuration before starting
the expensive native build and does not upload to Bugsnag.

## Build and upload

Use the workflow **Build Release and Upload to TestFlight (iOS)** on the exact
reviewed feature branch. The workflow preserves branch names containing
slashes.

1. First use `upload_to_testflight=false` to verify a signed Release archive
   and exported IPA.
2. The macOS verifier checks bundle identities, entitlements, signing team,
   embedded profiles, extension signatures, and arm64 architecture. It emits
   an IPA SHA-256 receipt. Confirm the build source revision as well.
3. To reuse the signed artifact without rebuilding, set `source_run_id` to its
   successful release run. First keep `upload_to_testflight=false` for verification
   only; then set it to `true` to upload that same package. Confirm Apple's
   processing result in App Store Connect; a successful upload alone does not
   mean testers can install it.
4. Complete the applicable beta metadata, export-compliance questions, tester
   access, and any required Beta App Review from verified facts.
5. Install through TestFlight on the intended iPhone and perform the device
   checks below. Do not label a simulator artifact as an iPhone download.

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
