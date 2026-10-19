# iOS Tools navigation qualification correction — 2026-10-19

Candidate ad776226287682d82ef43271ec72e569e639fae4 failed the general iOS gate:
https://github.com/romanmodin/RedWallet/actions/runs/39193337710

The TLS suite passed 7 tests. The wallet suite passed 14 tests, failed one settings-navigation test, and retained 5 unsupported-feature skips. Funded BIP84 iOS run39193351056 passed separately.

The first actionable failure was waiting for AddressInput after tapping IsItMyAddress upon returning from Broadcast. The retained failure screenshot shows Tools still open, scrolled with CoinJoin and the address-check row beneath the iOS glass header. This supports a driver hit-target/scroll-state problem; native confirmation of the correction is still required.

Correction: identify the existing Tools scroll view with SettingsToolsRoot. After returning from Broadcast, scroll to the top and require CoinJoin and IsItMyAddress rows visible before tapping. Preserve the destination AddressInput assertion and negative address-ownership result. No timeout extensions, retries, skipped tests, or transaction-validation changes.

Retained evidence on Zorin: /tmp/redwallet-ios-failure-39193337710.log and /tmp/redwallet-ios-evidence-39193337710/ (GitHub artifact e2e-ios-videos id12162936940). Test wallets only.

This replacement source must pass fresh exact-source CI, general iOS, and funded BIP84 iOS gates before signing. Existing release workflow pins still refer to the failed previous source; update them only to the verified replacement qualification. Android remains deferred. Full physical-device CoinJoin qualification is not established.

Local validation: four focused Settings/CoinJoin component suites passed (11 tests); full TypeScript and lint passed with 0 errors and 19 existing warnings. Logs: /tmp/redwallet-tools-scroll-unit-20261019.log and /tmp/redwallet-tools-scroll-lint-20261019.log. Native correction remains pending the new iOS gate.
