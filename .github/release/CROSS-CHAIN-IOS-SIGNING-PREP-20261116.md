# Cross-chain Lightning iOS signing preparation

Inactive draft preparation for PR256, stacked on the existing combined Lightning candidate PR254. Do not dispatch signing or upload while source qualification is incomplete. Crash reproduction remains with Gitar in PR258 / issue257; no crash fix is claimed.

## Pinned source

- Public and app source: `cc101b5f329264293887e4879ba105f4439ef68c`.
- Production tree: `d1ecaef7924e6ec694745102bf20569b19dbd5fa5d9801cc49e88767f17a27c4`; 1131 tracked production paths.
- Source mapping passed locally. This is not a binary-reproducibility claim.
- The release branch alias `release/ios-combined-lightning-bridge-20261116` points to this same commit for the existing native qualification variant.

## Required gates

| Gate | Exact-source run | Last observed state |
| --- | --- | --- |
| Software | 43835876974 | Passed: 187 unit suites, 3296 tests passed / one skipped; separate mocked bridge and disposable SHA256 consensus integration passed; lint passed |
| iOS application | 43835876886 | Running; no pass yet |
| Disposable on-chain iOS | 43836533300 | Queued; dispatched once |
| Embedded XBT LND | 43835877072 | Policy passed; native simulator jobs queued |

The existing verifier still requires completed successful current attempts and every required job. All main-only dispatch, ios-signing/ios-upload environments, source mapping, native LND mainnet verification and signed IPA checks remain intact. This draft only repins the build configuration and adds this document; it does not change app code, deploy, sign or submit anything.

## Candidate beta notes (not published)

- Pay a SHA256 Lightning invoice using XBT Lightning: scan/paste, choose a processor, request a quote, review the rate/spread, exact amount, fee limit and expiration, then authenticate and confirm.
- Kilombino is the only currently implemented processor. The current adapter uses the embedded iPhone XBT LND node.
- Cross-chain history tracks pending, uncertain, settled and failed outcomes across app restarts without automatically retrying uncertain payments.
- Existing background grace, BOLT12 offers and editable Lightning node name are inherited from the combined candidate.
- Independent third-party liquidity, availability and counterparty risks apply; the iPhone can still suspend the node. Quote expiry is not an HTLC refund deadline.

## Completion conditions

Inspect actual native logs/artifacts, including the six new Swift bridge tests, and re-run the unchanged source/gate verifier after completion. Gitar code review is approved; no physical iPhone cross-chain payment has occurred. A small real-network payment requires separate explicit authorization.

After qualification and reviewed source integration, signing would produce a new exact-source IPA receipt. Upload and tester assignment remain separate. The existing uploaded-beta verifier and assignment workflow are intentionally unchanged and pinned to the old delivered package; update them only after reviewing an actual new upload receipt with its build number, IPA hash, orchestration commit, successful upload run and Apple state. Never substitute placeholders or older receipts. No TestFlight readiness is claimed by this preparation.
