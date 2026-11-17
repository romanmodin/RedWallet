# Combined Lightning and hardware test candidate

This candidate combines the reviewed Lightning bridge source `a9af60e7f28dbc68768164e7ccd4da33eefdeccc` (PR260) with hardware source `b2f55b82831d6056d8ca6f9d492dac50c8a6d729` (PR265). It retains current main's grouped Native SegWit/Taproot receive options. Existing feature branches and their qualification runs remain intact.

The integration changes are additive: both wallet-settings imports, both locale sections and glossary entries are retained. English and Russian are merged by JSON key against the common ancestor. The current receive/account-group implementation is unchanged from the bridge parent. The dedicated simulator workflow accepts this candidate branch.

## Enabled behavior and limits

- The Lightning provider selector and Kilombino payment flow retain explicit approval, persistent uncertain-payment handling and native foreground checks.
- BOLT12, bounded background grace and node naming are retained from the bridge parent.
- Settings → Tools → Hardware signing check transfers an invalid-funded offline fixture and verifies its returned signature. It cannot broadcast or spend funds.
- Scanner sessions discard canceled or late results and block duplicate completion.
- `STANDARD_HARDWARE_RELEASE_ENABLED` remains **false**. This integration does not enable live standard-SIGHASH hardware payments or change chain-separation policy.
- Existing SHA256 watch-only, on-chain, receive/account grouping and CoinJoin functionality is retained. Pending unrelated branches are not implicitly merged.

## Required evidence

The parents' passing tests establish their individual results, not a pass for this combined source. Run the full software suite, isolated consensus and bridge-recovery tests, ordinary iOS wallet tests, embedded Lightning tests, BIP84 fee-bump flow, and the dedicated hardware simulator flow against this candidate's exact commit. Preserve source hashes and distinguish the simulator-only overlay from a release build.

The dedicated hardware flow decodes actual rendered QR pixels, but its incoming scanner data and signer are host-controlled public test fixtures. A physical iPhone camera round trip with the user's Keystone 3 Pro, Cypherpunk 3.0.2, Sparrow mode remains necessary. The previously verified device signature is evidence of offline compatibility, not this combined app's camera pass.

The old signing/upload workflows and PR259 still pin an earlier source. They must not be dispatched as if they build this candidate. Prepare and review new exact-source release pins only after the required combined-source gates pass. No signed package, TestFlight availability, real-money payment or Settings-crash fix is implied by this merge. Live-funds tests still require explicit authorization.

## Native follow-up, 16 November 2026

The native account-import failure is traced to UIKit smart punctuation in the scanner's manual text field. Run 43968188691, source 697e678, failed the new exact-text assertion before submitting to the parser. Its Detox artifact records U+201C/U+201D quotation marks and U+2019 apostrophes where the public JSON supplied ASCII quotes and apostrophes. The earlier b2f55b8 run's account error is consistent with rejection of that malformed JSON.

The iOS manual QR field now uses the email keyboard, for which UIKit disables smart quotes, and disables smart insertion/deletion of spaces. Android retains its visible-password keyboard. This changes keyboard behavior only: scan contents are never normalized, and the strict account parser continues to reject curly-quoted JSON. Apple documents the keyboard behavior at https://developer.apple.com/documentation/uikit/uitextsmartquotestype/default .

The scanner, offline UI and fixture/verifier suite passes 67 tests, including exact manual handoff of both valid and malformed account text; TypeScript and lint pass. These component tests do not emulate UIKit. Native run 44005700815 on ef7a6c8 subsequently passed the exact-text assertion and imported the account without a parser error; its receipt records offlineAccountInputExact=true. The full QR/signature flow remains unqualified.

A separate, reproducible mobile Buffer defect prevented every supported signature-return format from being verified: typed-array views need not retain Buffer's equals method. The verifier now uses the existing byte-comparison helper at all three PSBT-header checks. Five regression cases failed before this fix and pass afterward. They also pin the unchanged public-fixture hash and reject unsigned and altered responses. The focused fixture/UI/payment suite passes 71 tests; the three native-host checks, TypeScript and changed-file lint pass.

The simulator test now asserts the exact injected text and checks for an account error before scrolling. The simulator-only overlay exposes the failing stage, an allowlisted error class and up to eight numeric stack positions. It exposes no scan contents, key/account data or exception messages, and is absent from device/release builds. The diagnostics remain restricted to the simulator while the full native flow is pending.

Because this PR targets a release branch, the dedicated hardware workflow's main-only PR filter requires manual dispatch. Run 43957973446 was dispatched explicitly for combined source 1143b0137dabd5048b66086b2a02495689ae6801. A passing older source cannot qualify the Buffer follow-up. Gitar's combined integration review is approved with no open findings; it has not executed native tests. Signing and TestFlight remain blocked on the required exact-source native results and release preparation.

## Native follow-up evidence, 17 November 2026 UTC

Run 44005700815 reached the rendered hardware QR after importing the exact public account. The next failure was the visibility heuristic for the noninteractive HardwareCheckRequest wrapper. Its native frame was (20, 228.67, 362, 362) in a 402×874 viewport, and the saved screenshot showed the complete QR. The verified evidence archive is artifact 14296226638, SHA256 c533fc9f0ddfc498f6517fe6c71e386a5907e68a94a8a830ab088cb8a32fcf46. The receipt reports cleanupComplete=true and passed=false.

The test now scrolls the hardware check to the bottom and waits for the QR request to exist. The existing screenshot/Core Image decoder remains the decisive visibility check: it must reconstruct the actual on-screen crypto-PSBT and match the exact expected fixture. No outgoing request is injected, no visibility threshold is lowered, and unsigned-response rejection, signature verification and the isolated payment assertions remain required. This harness correction does not change the app.

For ef7a6c8, the software and Android workflows passed, and both hardware and ordinary iOS simulator builds compiled. The dedicated hardware flow did not pass. BIP84 run 44005704212 stopped before recovery after a tap failed to leave Add Wallet; its screenshot is not an ImportWalletScroll visibility false positive. The embedded Lightning Tor smoke failed connecting to the configured public onion peer with a SOCKS failure. Neither result may be counted as passing. No production signing or TestFlight release is qualified by these partial results.

## Visible signing result on return from the scanner

Run 44012168877 on 05f2793 successfully imported the exact public account and reconstructed the on-screen crypto-PSBT from three screenshots. It then rejected the unsigned response correctly, but the rejection message was below the viewport: the native text element was at y=899 in a screen of height 874. The retained visible-result assertion correctly failed. Evidence artifact 14299756416 has SHA256 7d70d367cf2d963ba09e80470715071c5ada8bec29a100df1107c52cc7722dcd. Cleanup completed; the overall flow did not pass.

The hardware-check screen now shows either verdict directly below its heading and returns to the top when a result arrives and the screen regains focus. Retry, reset and verification behavior are unchanged. The native result-visibility assertions remain unchanged; the test does not scroll to rescue hidden feedback.

For 05f2793, software, Android, embedded Lightning (including Tor) and the native BIP84 fee-bump flow all passed. Ordinary iOS was still running at inspection. Those results qualify that source only; this visible-result change requires fresh native verification.
