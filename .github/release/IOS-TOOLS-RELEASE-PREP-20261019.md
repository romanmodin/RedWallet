# Qualified combined iOS release orchestration — October 19, 2026

Frozen application source: 0e36e37ad797b13b711d2606b52ac70ea52e873f.
Production mapping: 985 paths, SHA256 4fe2b1a5a4619f002d7b7cc19781d7fcee5b182f16de19cb831e63f172893f63.

The existing gate verifier confirmed all required current-attempt jobs on this exact source at 2026-10-19 08:20:15Z. Receipt: IOS-COMBINED-QUALIFICATION-20261019.json.

- CI: https://github.com/romanmodin/RedWallet/actions/runs/39206955313
- General iOS: https://github.com/romanmodin/RedWallet/actions/runs/39206955356
- Funded BIP84 iOS: https://github.com/romanmodin/RedWallet/actions/runs/39206955341

PR58 merged at 08:20:35Z as 119783c880c26474a6b93444594e4ecdf596225e and includes PR56. The candidate retains the Tools navigation correction and adds bounded read-only recovery observations. All original incomplete-scan, import, balance, fee review and transaction assertions remain. Main-app amber, opt-in experimental CoinJoin and PR55 screenshot capture correction remain included.

Both release workflows now pin this qualified source and these three runs. Environment protections, exact-source verification, signing/upload checks, encrypted IPA handling and screenshot provenance are unchanged. Older-source passes do not qualify this candidate. Hosted checks do not establish physical-phone, ColdWallet or full native CoinJoin/recovery interoperability.

After merging this orchestration, verify main's production mapping and check for duplicate runs before dispatching protected signing/upload and actual screenshot capture. Update distribution pins only from the verified new upload receipt and Apple processing result. Inspect fresh empty-wallet screenshots before upload. Check saved reviewer notes and the privacy policy URL after stable Apple authentication, then select the correct new build and submit App Review. No new upload, delivery or Apple submission is claimed by this source qualification receipt.
