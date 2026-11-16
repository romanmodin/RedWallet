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
