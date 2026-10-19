# iOS Tools correction release preparation — October 19, 2026

This is preparation only. Native qualification is still running; do not merge or dispatch the release until the three exact-source gates pass and PR56 is merged.

Frozen replacement application source: 823470d7fae4b7d12d3bc3e90e242f528a8ce80f.
Production mapping: 985 paths, SHA256 4fe2b1a5a4619f002d7b7cc19781d7fcee5b182f16de19cb831e63f172893f63.

The replacement adds a Tools scroll-view test identifier and restores the test scroll position before tapping the address checker. It preserves all destination/ownership assertions and the main-app amber, opt-in experimental CoinJoin behavior. PR55 screenshot capture correction remains included.

Required exact-source gates:
- CI https://github.com/romanmodin/RedWallet/actions/runs/39200157454
- General iOS https://github.com/romanmodin/RedWallet/actions/runs/39200157445
- Funded BIP84 iOS https://github.com/romanmodin/RedWallet/actions/runs/39200157419

Both release workflows are repinned to these runs and this source. The existing gate verifier, environment approvals, signing/upload checks, encrypted package handling and screenshot provenance remain unchanged. The older ad776 general iOS gate failed and cannot qualify this release.

After qualification, verify the production mapping, merge PR56 with its exact-head guard, then merge this orchestration preparation. Check for duplicate runs before dispatching protected signing/upload and actual screenshot capture. Update distribution pins only from the verified new upload receipt. Select the correct new build, verify existing reviewer notes before adding CoinJoin detail, and publish the privacy policy URL for this source before App Review submission. Apple authentication still needs a stable session; no new release or submission is claimed here.
