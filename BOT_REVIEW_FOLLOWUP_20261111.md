# RedWallet review follow-up — 2026-11-11

Reviewed against main `2e32f40fb67c58f10c31ceceab375e920a826fcf`.
The inventory covered all 219 existing pull requests (open, closed and merged), every submitted review on those PRs, all 18 repository inline review comments, and all 31 repository issue/discussion comments. No review-response page reached the 100-item limit. Latest comment recheck: 2026-11-11. This is an inventory of the available review findings, not a claim that all wallet code has been independently security-audited.

## Recent bot findings

| Source | Finding | Disposition |
| --- | --- | --- |
| [PR 26](https://github.com/romanmodin/RedWallet/pull/26) | Retired relay keeps making paid lease polls | Fixed separately on that feature branch in `86d114b19690e77785a0cbda2ccdaf174e072e74`. Terminal expiry, revocation or both publications closes the listener, clients and poll timer permanently for that process. Temporary lookup errors still recover. |
| [PR 63](https://github.com/romanmodin/RedWallet/pull/63) | Frozen selected outputs reach Send; delayed writes race metadata | Fixed here. Freeze selected outputs synchronously; never rewrite unrelated metadata from a delayed snapshot. Both Coin Control entry points recheck current spendable outputs after saving, reject frozen/reserved/missing selections, and pass current wallet outputs. |
| [PR 152](https://github.com/romanmodin/RedWallet/pull/152) | Automatic confirmation clears unrelated errors | Fixed here with separate action and confirmation errors. Successful automatic retries clear only the confirmation error. |
| [PR 152](https://github.com/romanmodin/RedWallet/pull/152) | Unconditional recovery refresh erases frozen-output notice | Fixed here. Only eligible uncertain, reviewed journals trigger automatic recovery reads; preserve the confirmed frozen-review notice when no further work is pending. |
| [PR 195](https://github.com/romanmodin/RedWallet/pull/195) | Stale SHA-256 tip rejects newly confirmed UTXOs | Fixed here. Refresh tip before UTXO reads; make one bounded additional refresh if a newer block arrives during the request. Future or malformed heights remain rejected. |
| [PR 195](https://github.com/romanmodin/RedWallet/pull/195) | Cached history keeps transaction confirmations stale or zero | Fixed here. Verify raw transaction ID, then read live history for its output script. Refresh tip and block timestamps. Reconnect and reorg tests require confirmations to change without a wallet-wide history scan. No server-reported output amounts are trusted. |
| [PR 194](https://github.com/romanmodin/RedWallet/pull/194) | Face ID success canceled by transient iOS inactive state | Already fixed on current main by `authorizeInForeground`. Current screen regressions verify transient inactivity succeeds, while real backgrounding, navigation, dismissal, rejection and timeout cannot submit. |
| [PR 199](https://github.com/romanmodin/RedWallet/pull/199) | Failed resize still says to wait for peer locking | Fixed here. Aborted, dead and conflicted resizes show a terminal failure explanation and omit waiting/lock-depth promises. |
| [PR 200](https://github.com/romanmodin/RedWallet/pull/200) | No UI path persists default-server opt-out | Fixed here. Explicit Remove server action persists the opt-out, disconnects and clears backups; partial removal cannot reconnect. Explicit Save and Reset to defaults restore an endpoint. Reset failures no longer claim success. Repeated settings refreshes replace, rather than leak, their status timer. |
| [PR 201](https://github.com/romanmodin/RedWallet/pull/201) | Transactions heading lies outside the bounded header | Fixed here. Total balance, wallet cards and heading share the same 60%-bounded overflow region, leaving a transaction viewport in compact layouts. |
| [PR 76](https://github.com/romanmodin/RedWallet/pull/76) | Android evidence workflow checks out synthetic merge commit | Fixed here in both build and test jobs: use PR head SHA, or event SHA for non-PR runs. Existing APK receipts are not reused or relabeled as evidence for this change. |

## Historical PR 1 findings

All seven were already addressed on current main. Rechecked the present code and applicable regression suites:

- Crash reporting: `bugsnag.js` does not initialize reporting; regression requires no initialization or transmission.
- Inherited signing types and Android identity: storage allowlist rejects unsupported legacy signing records before loading/saving; explicit BTC wallet types are separate and selected-wallet scoped. Android uses RedWallet's separate application identity.
- Unsigned XBT PSBTs: every input declares Unified sighash `0x21` before returning a skip-signing PSBT; serialized round trip is tested.
- XBT fee bumping: the dedicated Unified replacement path has current regression coverage.
- Replay/deep links: shared-seed BTC-origin replay notice remains present. Native URL registration uses `redwallet`, and external routing refuses ambiguous payment URIs. Unified signatures do not eliminate BTC-origin replay risk for unsplit shared coins.
- Checkpoint claims: compatibility checking is explicitly distinguished from authentication/proof of the live chain.
- Coinbase maturity: verbose coinbase inputs are recognized; raw parent validation and maturity checks remain enforced.

[PR 223](https://github.com/romanmodin/RedWallet/pull/223) was rechecked after its bot review finished: it reports no open findings. Its separate Android build/release verification remains outstanding and is not represented as complete here.

## Validation

- 20 relevant unit/UI suites: **353 tests passed**.
- Relay branch: **12 tests passed**, including all three permanent-retirement causes, no future polling, and temporary-error recovery.
- Full repository lint pipeline (TypeScript, localization, metadata and ESLint): passed with warnings; changed/new files checked separately with zero warnings after cleanup.
- `git diff --check`: passed.
- No physical-device, App Store, TestFlight or production relay deployment is claimed. Fresh native builds and release verification remain necessary before distributing these changes.
