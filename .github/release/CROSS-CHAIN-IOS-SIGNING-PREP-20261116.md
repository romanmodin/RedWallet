# Cross-chain Lightning iOS signing preparation

Inactive draft preparation for PR260, stacked on bridge PR256 and combined Lightning candidate PR254. Signing and upload remain blocked until current-source qualification completes. Gitar owns the separate Settings-exit crash reproduction in PR258 / issue257; no crash fix is claimed.

## Pinned source

- Public and app source: `a9af60e7f28dbc68768164e7ccd4da33eefdeccc`.
- Production tree: `3b12a4dc89e5ad82a9253e12fa1e609de950c1e9e49025c2ce2891cb2b98f4e1`; 1134 tracked production paths.
- Source mapping passed locally; this is not binary reproducibility.
- Immutable qualification alias: `release/ios-combined-lightning-bridge-approval-20261116` at the same source.
- Includes isolated native HTTPS transport because React Native's XHR-backed fetch does not enforce `redirect: error`. No redirected invoice disclosure, shared cookies/credentials/cache or shared-fetch fallback; normal certificate validation remains enabled.

## Required gates

| Gate | Exact-source run | State at preparation |
| --- | --- | --- |
| Software | 43849209646 | Hosted workflow started; 142 focused tests, full TypeScript and changed-file lint pass on Zorin |
| iOS application | 43849209511 | Pending; no pass claimed |
| Disposable on-chain iOS | 43848906924 | Dispatched once; completion required |
| Embedded XBT LND | 43849209556 | Current native execution required; parent passed 12 bridge cases but failed Tor fee recovery |

The unchanged verifier requires completed successful current attempts and every required job. Main-only dispatch, ios-signing/ios-upload environments, source mapping, native LND mainnet verification and signed IPA checks remain intact. This preparation does not sign, deploy or submit anything. Previous source runs do not qualify this commit. Older running checks were left to finish.

## Candidate beta notes (not published)

- Scan/paste a SHA256 Lightning invoice, choose a processor before requesting a quote, review rate/spread, exact amount, routing fee ceiling and expiration, then authenticate and confirm.
- Kilombino is the only implemented processor. The adapter uses the embedded iPhone XBT LND node; external Umbrel and Android bridge adapters are not implemented.
- An interruption before submission requires new approval. Durable cross-chain history reconciles pending/uncertain outcomes after restart without automatic retries. Success requires local preimage, exact amount and fee verification.
- Background grace, BOLT12 offers and editable Lightning node name are inherited from the combined candidate. iOS can still suspend the node.
- Independent third-party liquidity, availability and counterparty risks apply. Quote expiration is not an HTLC refund deadline.

## Completion conditions

Inspect native logs/artifacts, including the foreground lifecycle regression, six payment-validation and six HTTP-transport tests, then run the unchanged source/gate verifier. No real-network bridge payment has occurred; a small real-network test requires separate explicit authorization.

After qualification and reviewed source integration, signing would create a new exact-source IPA receipt. Upload and tester assignment remain separate. Uploaded-beta verification and assignment intentionally retain the old actual receipt until a new signed/uploaded receipt provides the build number, IPA hash, orchestration commit, successful upload run and Apple state. No placeholder receipts or TestFlight readiness claim.
