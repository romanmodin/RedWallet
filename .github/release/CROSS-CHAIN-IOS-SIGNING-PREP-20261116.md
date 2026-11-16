# Cross-chain Lightning iOS signing preparation

Inactive draft preparation for PR256, stacked on combined Lightning candidate PR254. Signing and upload remain blocked until current-source qualification completes. Gitar owns the separate Settings-exit crash reproduction in PR258 / issue257; no crash fix is claimed.

## Pinned source

- Public and app source: `6d309fb01e5775daf622116f350d16e9bc1f1e64`.
- Production tree: `bcad4a8aab21608d6dbd98a96550c27d879ba92bead83f2f0eca2e64a24a1fe7`; 1134 tracked production paths.
- Source mapping passed locally; this is not binary reproducibility.
- Immutable qualification alias: `release/ios-combined-lightning-bridge-http-20261116` at the same source.
- Includes isolated native HTTPS transport because React Native's XHR-backed fetch does not enforce `redirect: error`. No redirected invoice disclosure, shared cookies/credentials/cache or shared-fetch fallback; normal certificate validation remains enabled.

## Required gates

| Gate | Exact-source run | State at preparation |
| --- | --- | --- |
| Software | 43840159031 | Running; local 132 focused tests, full TypeScript and changed-file lint pass |
| iOS application | 43840159048 | Pending; no pass claimed |
| Disposable on-chain iOS | 43840535907 | Queued; dispatched once |
| Embedded XBT LND | 43840158813 | Pending; twelve bridge Swift tests require native execution |

The unchanged verifier requires completed successful current attempts and every required job. Main-only dispatch, ios-signing/ios-upload environments, source mapping, native LND mainnet verification and signed IPA checks remain intact. This preparation does not sign, deploy or submit anything. Results from the superseded cc101 source do not qualify this source; its queued manual compatibility run was canceled after checking its source and alias.

## Candidate beta notes (not published)

- Scan/paste a SHA256 Lightning invoice, choose a processor before requesting a quote, review rate/spread, exact amount, routing fee ceiling and expiration, then authenticate and confirm.
- Kilombino is the only implemented processor. The adapter uses the embedded iPhone XBT LND node; external Umbrel and Android bridge adapters are not implemented.
- Durable cross-chain history reconciles pending/uncertain outcomes after restart without automatic retries. Success requires local preimage, exact amount and fee verification.
- Background grace, BOLT12 offers and editable Lightning node name are inherited from the combined candidate. iOS can still suspend the node.
- Independent third-party liquidity, availability and counterparty risks apply. Quote expiration is not an HTLC refund deadline.

## Completion conditions

Inspect native logs/artifacts, including six payment-validation and six HTTP-transport tests, then run the unchanged source/gate verifier. No real-network bridge payment has occurred; a small real-network test requires separate explicit authorization.

After qualification and reviewed source integration, signing would create a new exact-source IPA receipt. Upload and tester assignment remain separate. Uploaded-beta verification and assignment intentionally retain the old actual receipt until a new signed/uploaded receipt provides the build number, IPA hash, orchestration commit, successful upload run and Apple state. No placeholder receipts or TestFlight readiness claim.
