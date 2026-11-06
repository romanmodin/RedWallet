# Kilowallet 1.0.0 build 10 release handoff — November 6, 2026

This replaces the stale November 5 candidate handoff. Build 10 is signed, uploaded and internally available. External availability is blocked by the earlier build 8 beta review. Keep the existing public App Store review in place.

## Exact release identity

| Item | Verified value |
| --- | --- |
| App / bundle | 6824331953 / com.kilombino.kilowallet |
| Marketing version / build | 1.0.0 / 10 |
| Apple build ID | bccd1b6c-e89b-45e9-909e-0936bd558994 |
| Publisher source | 5ac15b5eeb26296d69008a39e7ff1b4e23d4f8c5 |
| Source tree | 803460785f25cfc0770cfa8b70639b27ca4435d2 |
| IPA SHA-256 | df8e64471039b6964e45347b16e41371ed99da69e312c3d544b95d2b5b147830 |
| Protected upload | romanmodin/RedWallet run 42253151290, attempt 1 |
| Upload coordinator | 3fe9280ee0a6dd06e623dc57d8fc1a1610fe4f3a |
| Release verification artifact | 13524776804 |
| Verification ZIP SHA-256 | bff4e54bb855d9ad08affb191d696e62ee194f4b9e0ad255f366204fabeb3fce |

The publisher app PR13 merged as 14e5ce0a8211eac64a8fa1c025a508880ea918e2 with the same qualified tree. Preserve immutable source/artifact pins in verify-kilowallet-upload.py; no rebuild or new build number is needed for review metadata or the beta-review guard.

## Completed qualification

- Full native run 42182220263/attempt1/job127774217736 passed. Actual PR checkout 5cde91d9cb594879fc4cdfd97ca1631474505352 has the qualified source tree. 425 nonoptional native tests, 10 synthetic migration/isolation tests, runtime and unsigned arm64 Release gates passed.
- Exact-source checker 42188560912/attempt1/job127794665913 passed.
- Focused visual/runtime run 42234792388/attempt1/job127949512217 passed. Its harness commit is 8314fe533d246b73f20c46f77a9a28b4ae2fa927; this is a test harness, not a replacement app source. All nine Create/Settings/LND captures were visually inspected for complete glyphs. Settings and re-entry met the existing deadlines; same-process re-entry was observed.
- The focused simulator runtime observed Tor, an onion peer, watchtower registration, empty SCB RPC and completion. This does not prove funded-channel recovery, accepted justice backups, persistent peer connectivity after backgrounding, a physical-iPhone install or publisher joint-regtest interoperability.
- Focused artifact 13515939118, SHA-256 005de209ee27a7c8847a192b71693623fadb533703f64b3f12393ac6a1114cbc, and release artifacts were checked against API digests and ZIP CRCs.
- Protected upload verify/qualify/certificate/sign jobs all succeeded. Archive and IPA signatures, native frameworks, source receipts and Apple VALID processing were verified. Encrypted IPA artifact 13523723216 remains encrypted.
- Postmerge app run 42252781067 was not acquired by a hosted runner and its native job had zero executed steps. That infrastructure cancellation is not a product regression and does not replace the successful immutable qualification above.

Source/product preservation: persisted seed/address identities, wallet-scoped Ark/LND storage/backups and pending/frozen/signed-input guards remain covered. Qualification uses synthetic wallets only; no user funds were moved.

## TestFlight checkpoint and next action

Protected GET-only diagnostic 42267938803/attempt1 observed Apple at 2026-11-06T18:09:19.259Z:

| Build | Internal state | External state | Beta review |
| --- | --- | --- | --- |
| 1.0.0 (10) | IN_BETA_TESTING | READY_FOR_BETA_SUBMISSION | None yet |
| 1.0.0 (8) | Not requalified here | WAITING_FOR_BETA_REVIEW | WAITING_FOR_REVIEW |

Build 10 membership is verified independently from both sides for the original Internal group 8f0948f4-86ef-4f7a-aa47-830a6e8f4eae and Public Beta group f4f2520c-3eaf-46f9-a31a-a36d38b74c53. Membership alone does not make the external build installable.

The earlier beta-review POST returned HTTP422; its original response body was not retained. The later GET diagnostic independently confirmed the active same-version build8 review. Do not claim a recovered exact Apple error detail. Diagnostic artifact13528431369, SHA-256922dadb045887150078a2d6353c8b5038bff0c3caa0459de041e81ba6d9d730e, has no executed HTTP writes.

Publisher PR187 added GET-only diagnose; PR188 added an immediate pre-POST prior-review check, merged at 0ac2b8be27399114fe7704b43aa10bf984853571. Hosted run42268294320 passed47Node+8upload tests. The guard blocks an active, unreadable or inconsistent prior review before mutation.

Next: inspect existing jobs, then use the existing protected workflow with action=diagnose at an appropriate interval. After build8 review completes, reconcile fresh build10 state and invoke one guarded apply only if still needed. Re-read the exact build and both group relationships, and require actual external testing eligibility before announcing public beta access. Do not withdraw build8 or repeatedly retry the rejected POST.

## Public App Store release gate

Last verified public snapshot was 2026-11-06T17:28:16Z, GET-only run42261849456/attempt1: existing0.4.0 version1ca23695-4563-4a0e-b20e-d1a6457f4f8b WAITING_FOR_REVIEW, exactlyUSA and automatic territory expansion disabled. This is a timestamped observation, not a claim of current approval or availability.

After intended TestFlight access qualifies, refresh public status and prepare the replacement using KILOWALLET-100-RC4-METADATA-DRAFT.md. Reconcile live privacy labels, review contact details, screenshots and any reviewer correspondence. Preserve0.4.0 review until the replacement is eligible. No deletion of an existing public version, withdrawal of another app, new agreements or unsupported legal attestations is authorized.

Encryption: build10 Boolean ITSAppUsesNonExemptEncryption=false and no export-compliance code reflect the previously observed Apple questionnaire and USA-only scope. No ECCN, CCATS or general legal classification is claimed. Do not widen territories or reinterpret the questionnaire in this handoff.

Privacy: the actual publisher source sets Bridge.torPort to null, so the bridge uses HTTPS/Cloudflare even with node Tor running. Ark has an independent operator and retention policy. CoinJoin v6 remains explicitly signed and is not a continuous background service. Do not reuse old RC3-only review text or a blanket no-data-collected assertion.

## Durable evidence

- /home/roman_modin/kilowallet-release-evidence/signed-rc4-42253151290-attempt1
- /home/roman_modin/kilowallet-release-evidence/lnd-frame-42234792388-attempt1
- /home/roman_modin/kilowallet-release-evidence/review-diagnostic-20261106

Record every subsequent Apple result with exact observation time, build, run, attempt and receipt digest. Update project memory and Knowledge. Keep the existing continuation active until public availability is verified; create no new automation.
