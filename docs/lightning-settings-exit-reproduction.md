RedWallet on iPhone reportedly exited twice in one day when leaving XBT Lightning Settings. Latest report explicitly identifies the Lightning settings screen, rather than general settings. Treat this as a release-blocking investigation until there is diagnostic evidence and a verified fix or exclusion.

Observed facts:
- Last verified delivered public build: 8.0.1 (1794496288), source 66c7fd5e462b03a56e89d0186deb8d89f739b02c. This is delivery evidence, not proof of the phone's installed version.
- Pending #254 (background/BOLT12/node naming) and #256 (cross-chain payments) are not deployed to the phone by this pipeline.
- No device .ips/exception/stack trace has been obtained. Root cause is unknown; do not present a suspected lifecycle race as a confirmed crash cause.
- Shipped in-app Bugsnag reporting is deliberately disabled for wallet privacy. Apple TestFlight diagnostic collection is separate.

Reproduction to investigate on a disposable, unfunded fixture: open XBT Lightning Settings from the Lightning wallet, allow node/channel/network refresh, then leave using Back; repeat with delayed RPC responses and pending refreshes. Also compare no-running-node and running-node states. Preserve all wallet data and do not reset/restore or use real funds.

Source targets: screen/settings/XBTLightning.tsx, components/XBTLightningNetwork.tsx, screen/wallets/LndWalletHome.tsx, native XBTLightningBridge and screen navigation. Review timer/listener cleanup, late refresh/secure-storage completion, native callbacks and navigation transitions. A regression must demonstrate the actual failure; ordinary JS tests alone cannot establish a native crash fix.

Required evidence: device BlueWallet/RedWallet .ips (binary name is BlueWallet) around the event or JetsamEvent, installed build, exception/termination reason and stack. Until then, retain and label hypotheses separately from confirmed defects.


This isolated draft is the reproduction workspace for issue #257. Gitar is authorized to add and run tests here and, if supported, reproduce navigation in a disposable unfunded simulator. Current production code is unchanged at branch creation. Record source SHA, actual commands/results and diagnostic evidence. A JS-only regression cannot prove the reported native crash is resolved. Any proposed production fix must have a demonstrated defect and remain separately reviewable. Do not merge or release this draft.
