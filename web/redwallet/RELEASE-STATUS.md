# RedWallet Web release status — 2026-10-01

Public release: 0.37, Caffeine 39. Web branch: `web/caffeine-bridge-deployment`.
This record supersedes earlier watch-only/unmounted statements in foundation
notes. It describes the current scoped preview, not a version1.0 claim.

## Completed verification

| Area | Evidence |
| --- | --- |
| Current frontend |63 files / 382 tests PASS; TypeScript, Biome 219 files and production build PASS |
| Bridge |80 tests, typecheck and build PASS in0.33 verification; unchanged since |
| Published backend |25 PocketIC tests against exact Wasm; unchanged digest in0.37 export |
| Pure Motoko contracts |16 tests PASS with locked dependencies and native compiler |
| Signer |Eight Knots vectors, accepted fixture parity, synthetic signing and browser-without-Node-globals checks; node acceptance/replay-negative evidence in `test/regtest` |
| Release import |All 373 reviewed 0.37 source paths exactly match actual Caffeine export |
| Browser lifecycle |Disposable fixture recovery/unlock/reload/navigation lock, retained scan/draft/history, provider selection and protection checks recorded in0.23–0.37reports |
| User iPhone checks |Connection changes and background/unlock retain history;0.37Keychain automatic zoom fix confirmed by user |
| Backup routing |Live mempool.guide protocol/checkpoint/reads and real router with simulated primary outage PASS; production primary stayed online |
| Payment |User reported sending and confirmation; automated public fixtures cover planning, signing, dispatch and reconciliation. Agent did not submit a funded payment |

The unchanged published backend SHA256 is
`6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001`.
Counts above come from separate verified runs; they are not all rerun in0.37.
See V033, V034, V037 and V037-FINAL reports for exact evidence and scope.

## Remaining scope and limits

- Native SegWit account 0 only. Taproot, legacy-input spending, unconfirmed and
  coinbase inputs, RBF UI and multi-account recovery remain future features.
- Recovery is bounded by the selected unused-address gap and per-branch limit.
- Completed scans are saved; unfinished progress can resume only in the same tab.
- Backup verification used simulated primary failure. No real production outage
  or funded backup send was induced. Public backup availability is controlled
  by its operator, not guaranteed by RedWallet.
- The canister consumes cycles. A prepaid canister still requires balance and
  availability monitoring; a second canister alone does not create a second node.
- Production protections and checkpoints reduce specific risks; they do not
  establish full independent chain verification or immunity to compromised code.

## Automatic regression coverage

The separate `.github/workflows/redwallet-web.yml` runs frontend and bridge
checks on web-path pushes and pull requests with Node 24, pnpm 10.14.0 and the
frozen lockfile. It uses read-only repository permissions and no wallet/operator
secrets. It does not deploy the app or run native iPhone checks. Backend artifact
and Motoko verification remain explicit isolated lanes.

First GitHub workflow run: pending verification. Public app remains0.37;
this documentation/workflow follow-up changes no product runtime code.
