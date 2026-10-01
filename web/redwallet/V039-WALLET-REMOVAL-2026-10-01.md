# 0.39 — Individual wallet removal

Encrypted wallet rows now offer Remove. Opening confirmation locks keys; final removal requires a backup/disposable-wallet acknowledgment and the exact wallet name. Only the selected ciphertext and label are removed. Funds stay on the network; recovery needs the phrase and any BIP39 passphrase. Public history and address indexes remain to support recovery without address reuse. Other vault copies remain intact.

Watched addresses can be removed individually. Demo accounts can be removed individually, hidden together, and restored. These preferences persist in this browser. The dashboard offers onboarding when no accounts remain rather than an endless loading spinner. Cross-tab vault changes discard live sessions while preserving saved scans.

Tests cover confirmation gates, cancel, pending-unlock cancellation, another vault surviving, storage deletion failure, demo/watch removal and reload, restoration, and saved scan preservation. Frontend/bridge clean CI and publication results are recorded below after verification. No network, signing or native iPhone behavior changed. Only disposable fixture storage is deleted in automated tests; live browser checks cancel encrypted removal.

## Clean verification

GitHub run36921093626 at source b8fd08687174a8440b80d07c4981fb28e752d084 completed successfully: pinned Node24/pnpm10.14.0 frozen install, production audit, frontend typecheck/lint/tests/build, bridge typecheck/tests/build. Publication is pending: Caffeine signed out; Google passkey challenge returned Something went wrong. Source archive prepared with377tracked app files. No0.39 live claim.

## XBT quote follow-up

User found demo balances still using the historical64,250USD sample rate. All visible demo fiat amounts (dashboard, wallet rows, transaction rows/details, send balance and fee estimates) now use the same NeoxEX/manual XBT quote component as real accounts. Unknown quotes remain unavailable and automatic quotes are labeled USDC. Simulated XBT balances remain marked demo. Dashboard regression uses355.15USD/XBT and rejects former BTC-sized output.18focused price/dashboard/settings tests, typecheck, Biome220 and build PASS. Fresh final CI required before publication. Sign-in has been restored.

## Published and verified

Caffeine42/public0.39 LIVE on2026-10-01. Final clean GitHub run36922369490/source b95792db45dbaec3468ee4ad1ea28c146a23bd5b PASS:63frontend files/388tests, Biome220, typecheck/build, production audit with0known advisories, bridge typecheck/tests/build. All378reviewed paths in redwallet-039-source-final.zip byte-match actual exported redwallet (37).zip. Backend SHA256 remains6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001.

Live checks PASS: exact RedWallet0.39 settings label; encrypted confirmation disabled with name alone, enabled with backup acknowledgment, Cancel preserves both fixture vaults; Cold Savings demo removal persists across reload and leaves other demo/vault entries; hide-all persists across reload and dashboard shows onboarding; restore brings back all3demo entries. Connected primary unchanged. Demo dashboard and rows use configured NeoxEX USDC estimate (475.79USDC/1.2485XBT from the retained quote, visibly Stale), with no old64,250USD output. No irreversible browser vault deletion or funded payment performed.

Proof: redwallet-039-removal-and-xbt-price.jpg, saved. Public app /wallets verified. This supersedes the earlier publication blocker. Runtime is unchanged after the verified final source; follow-up documentation only.
