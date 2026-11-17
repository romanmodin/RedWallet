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

The scanner, offline UI and fixture/verifier suite passes 67 tests, including exact manual handoff of both valid and malformed account text; TypeScript and lint pass. These component tests do not emulate UIKit. The existing native exact-text assertion must pass, followed by the full QR/signature flow, before declaring the native fix verified.

A separate, reproducible mobile Buffer defect prevented every supported signature-return format from being verified: typed-array views need not retain Buffer's equals method. The verifier now uses the existing byte-comparison helper at all three PSBT-header checks. Five regression cases failed before this fix and pass afterward. They also pin the unchanged public-fixture hash and reject unsigned and altered responses. The focused fixture/UI/payment suite passes 71 tests; the three native-host checks, TypeScript and changed-file lint pass.

The simulator test now asserts the exact injected text and checks for an account error before scrolling. The simulator-only overlay exposes the failing stage, an allowlisted error class and up to eight numeric stack positions. It exposes no scan contents, key/account data or exception messages, and is absent from device/release builds. The diagnostics remain restricted to the simulator while native verification of the keyboard fix is pending.

Because this PR targets a release branch, the dedicated hardware workflow's main-only PR filter requires manual dispatch. Run 43957973446 was dispatched explicitly for combined source 1143b0137dabd5048b66086b2a02495689ae6801. A passing older source cannot qualify the Buffer follow-up. Gitar's combined integration review is approved with no open findings; it has not executed native tests. Signing and TestFlight remain blocked on the required exact-source native results and release preparation.
