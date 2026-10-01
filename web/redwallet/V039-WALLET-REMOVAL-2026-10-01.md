# 0.39 — Individual wallet removal

Encrypted wallet rows now offer Remove. Opening confirmation locks keys; final removal requires a backup/disposable-wallet acknowledgment and the exact wallet name. Only the selected ciphertext and label are removed. Funds stay on the network; recovery needs the phrase and any BIP39 passphrase. Public history and address indexes remain to support recovery without address reuse. Other vault copies remain intact.

Watched addresses can be removed individually. Demo accounts can be removed individually, hidden together, and restored. These preferences persist in this browser. The dashboard offers onboarding when no accounts remain rather than an endless loading spinner. Cross-tab vault changes discard live sessions while preserving saved scans.

Tests cover confirmation gates, cancel, pending-unlock cancellation, another vault surviving, storage deletion failure, demo/watch removal and reload, restoration, and saved scan preservation. Frontend/bridge clean CI and publication results are recorded below after verification. No network, signing or native iPhone behavior changed. Only disposable fixture storage is deleted in automated tests; live browser checks cancel encrypted removal.

## Clean verification

GitHub run36921093626 at source b8fd08687174a8440b80d07c4981fb28e752d084 completed successfully: pinned Node24/pnpm10.14.0 frozen install, production audit, frontend typecheck/lint/tests/build, bridge typecheck/tests/build. Publication is pending: Caffeine signed out; Google passkey challenge returned Something went wrong. Source archive prepared with377tracked app files. No0.39 live claim.
