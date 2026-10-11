# RedWallet App Store candidate — 2026-10-11

Prepared metadata only; not uploaded or submitted. English candidate is deliberately isolated from inherited Fastlane translations. Do not upload the existing multilingual metadata tree: it contains BlueWallet names, URLs and unsupported feature claims.

## Remaining submission gates
- [ ] Verify Apple organization conversion or explicit exception and current legal seller status in App Store Connect.
- [ ] Confirm the exact selected iOS binary, processing status and source qualification from current Apple receipts.
- [ ] Publish/verify an app-specific public privacy policy and support URL. Do not use inherited BlueWallet privacy links as RedWallet policy.
- [ ] Audit actual data flows and third-party SDKs against App Privacy answers; the bundled manifest alone is insufficient evidence.
- [ ] Capture current screenshots from the selected binary with disposable demo data and required device sizes. Do not expose real balances, seeds or addresses.
- [ ] Prepare a reachable review-only compatible server and precise configuration instructions through Apple's private review fields. Never put credentials in this repository.
- [ ] Complete age rating, export-compliance and distribution declarations using verified facts.
- [ ] Review every enabled locale; replace or exclude stale inherited translations in the eventual upload configuration.
- [ ] Confirm reviewer can exercise create/import/receive and inspect settings without real funds; document safe disposable transaction testing separately.

## Reviewer notes draft
RedWallet is a self-custody XBT wallet. Configure the review-only compatible Fulcrum server using separately supplied review instructions. Use a disposable wallet; no real funds or personal recovery information are required for basic UI review. Server-backed transaction review must use an explicitly supported disposable environment. Do not claim an untested network mode works in the submitted binary.

## Evidence boundaries
Hosted native lifecycle tests exercise an app against real Fulcrum/Knots services in an isolated environment. These do not establish physical-phone or cold-device interoperability. Physical cold signing depends on completion of the user's separate cold-wallet project and must not be marked complete. TestFlight availability does not establish App Store publication.

## Attribution
Retain BlueWallet MIT license notices and applicable dependency notices. This package makes no claim of affiliation or endorsement.
