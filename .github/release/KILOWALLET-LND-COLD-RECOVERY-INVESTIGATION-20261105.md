# Build8 cold Lightning recovery investigation — November5,2026

Status: source analysis and retained diagnostic evidence, **not a reproduced engine fix**. Keep the public-release hold. No changes to the signed app, wallet birthday, stored identity, recovery window, engines, or trust rules.

## Observed evidence

Focused run42163150260/attempt1/job127713335608 used exact appe9aae6502f3a8a1aa7703424540d5a568214fa5e (same tree as signed source68461ec5) with the public synthetic abandon/about fixture. Artifact13480536179 SHA2560594fd63118223aa3aff6398c4bdd9cbd4fe844c98b7589bbbb1701bd61d48fb was API-digest and ZIP-CRC verified. It is not a successful runtime qualification despite the workflow's green status.

LND recovery started at height961640 at05:10:27Z. Peer block-fetch query548 timed out at05:13:53Z. Recovery then reported181 retries through05:32:24Z: `unable to persist initial sync data ... failed to fetch block hash for height 961638: block not found`. Towers were empty, onion-peer/SCB checks did not succeed, and native qualification completed:false. No real transaction was performed.

## Pinned source trace

The signed engine is Kilombino/lnd commitcae303b36594a2c48c9ce0cbb238672e3a1b284e. Its go.mod selects btcwalletf2c79d772865 and Neutrino replacement0.17.1-blake2b.1.1. Reads were GET-only; no author's repository was modified.

- [Pinned engine dependency inventory](https://github.com/Kilombino/lnd/blob/cae303b36594a2c48c9ce0cbb238672e3a1b284e/go.mod)
- [btcwallet syncWithChain](https://github.com/btcsuite/btcwallet/blob/f2c79d772865/wallet/wallet.go): initial birthday setup calls Manager.SetSyncedTo and then SetBirthdayBlock within walletdb.Update, before invoking recovery. The `unable to persist initial sync data` prefix comes from this transaction.
- [Address-manager sync](https://github.com/btcsuite/btcwallet/blob/f2c79d772865/waddrmgr/sync.go): SetSyncedTo delegates to PutSyncedTo.
- [Local sync storage](https://github.com/btcsuite/btcwallet/blob/f2c79d772865/waddrmgr/db.go): PutSyncedTo requires a previous-height entry when birthday metadata exists. Its fetchBlockHash reads the local sync bucket. This is the exact source of the nested missing-height error; it is not itself a remote block-serving error.

Inference to investigate: after recovery times out, a retry may enter initial birthday setup again while birthday metadata already exists, causing the local predecessor guard to fail. The preceding peer timeout is observed; the complete engine/database state transition and root cause remain unproved. Do not present this inference as a confirmed Neutrino or BLAKE2b bug. No wallet.db or channel.db was read or modified for this analysis.

## Next bounded verification

Preserve corrected diagnostic42170130823/attempt1/job127735762884 (orchestration0406e4d5add25326a721d5508e007b925a092b23), which uses the unchanged source and preserves all startup/recovery deadlines. It requires actual five-marker LND success, captures four app frames before deliberate cleanup and retains public chain/filter caches only. Do not cancel or duplicate it. If the error repeats, compare its exact chronology and dependency facts; test a fix only against synthetic wallets before any new candidate. A later pass can show intermittent recovery but does not establish an engine fix.

Potential maintainer questions if this repeats:

1. Is this recovery-timeout followed by PutSyncedTo's missing-predecessor loop known for the pinned engine/btcwallet version?
2. Is there an upstream fix or a regression test for retrying initial birthday setup after recovery aborts?
3. Can recovery safely resume without deleting the wallet, changing its seed/birthday, or skipping old addresses? Please provide exact engine commit and reproducible test evidence.

No engine upgrade or production workaround is proposed until that evidence exists. Existing internal build8 and public0.4review remain unchanged.
