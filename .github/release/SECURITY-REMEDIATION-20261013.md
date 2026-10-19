# Review remediation — 2026-10-13

Base reviewed main: 644f8431a3dbec1d1759255657a10564b6931ee1.

## Containment candidate
- XBT BIP84 RBF, cancellation and CPFP temporarily unavailable through wallet capability checks.
- All three legacy BIP84 transaction-builder entry points reject XBT before network reads or transaction creation. This also protects direct/stale screen calls and wrapped watch-only instances.
- Ordinary BIP84 send/receive and Taproot fee workflows remain supported.
- Four new containment checks failed on baseline. Existing real signed-transaction fixtures now assert rejection of fee actions while still cryptographically verifying ordinary-send Unified signatures.
- Not a shipped fix until exact-source CI/native gates, signing and release receipts are verified.

## Required follow-up before restoring BIP84 fee actions
- Rebuild replacements from txid-matched original raw bytes, verify signatures with raw-verified prevouts, preserve recipient scripts/values and reduce only owned change.
- Enforce replacement absolute/incremental fee rules and dust floors.
- Display decoded outputs, absolute fee and actual fee rate; apply high-fee review to every supported fee action and bind approval to exact transaction bytes.
- Reproduce malicious-server redirection and inflated-parent-fee cases, then require rejection.

## PR44 hold
PR44 remains unmerged at 06f19524b101e6fa49748edd5833dbee978a7d8f. Do not ship before rebasing onto containment/hardened fee review. Confirmation status is still server-trusted; missing confirmations become zero, so ancestor inflation requires explicit bounded cost/review coverage. Frozen-coin issue confirmed: getUtxo(true) includes frozen entries because the upstream implementation filters only when the argument is false. Fix and test hot/watch-only paths before shipping PR44.

## Remaining review queue
Android clipboard native expiry; Android widget outbound traffic; TLS defaults and checkpoint wording; legacy bucket migration/decoy limitations; signer credential isolation and provenance; reproducible node controller/receipts; remaining low findings. These are not marked resolved by this containment patch.

Physical cold signing remains dependent on completion of the separate cold-wallet project. No production funds, servers or signing credentials changed by this patch.

## Local verification
Four focused suites /35 tests passed after updating expected containment behavior. Earlier full unit run:86 suites passed, one lifecycle suite failed only because it expected now-disabled SegWit fee actions; that suite is included in the successful focused rerun. Full lint passed with one inherited encryption no-bitwise warning; final changed lifecycle test ESLint and TypeScript passed. Full exact-source CI and hosted native checks remain required.

## Authenticated BIP84 replacement planner (development only)
Added a pure planner with no decoded-server JSON input. It hashes original and parent raw bytes, verifies original P2WPKH Unified signatures and input ownership, preserves output scripts/recipient values, funds increases only from P2WPKH change above294sats, and requires original fee plus conservative incremental relay cost. Worst-case signature size is used for fee estimation. The planner now feeds a dedicated wallet builder for signed transactions and unsigned PSBTs. Shared XBT fee review displays decoded outputs and binds fee approval to exact bytes. No production fee-action route calls the new builder; BIP84 containment remains active. Node policy may require a greater incremental relay rate than the1sat/vB baseline. Do not present this module as restored RBF support.

Next: complete watch-only session integration, design separate capabilities for hardened replacement versus still-disabled legacy cancellation/CPFP, and run adversarial native and isolated Knots replacement acceptance before restoring capability. No physical cold-device interoperability is established.

Local builder validation: 37 tests across replacement, wallet transaction and containment suites passed. Final review validation: 27 tests across replacement, fee review and containment suites passed. Signed replacements were checked against independently constructed expected unsigned PSBTs; unsigned input fingerprints retain all four bytes. Full lint/TypeScript passed with only the inherited encryption.test.ts no-bitwise warning. Native exact-source gates remain pending; this is an unreleased development checkpoint.


## Change metadata checkpoint
Unsigned replacement PSBTs now include change-only BIP32 derivation paths, public keys and four-byte fingerprints. The public key must reproduce the actual change script; mismatches fail before signing. Four metadata checks failed before the fix; final replacement/review/containment regression run passed all 32 tests, including a mismatched-key rejection. This does not establish external-device compatibility or restore fee actions. Local logs: /tmp/redwallet-change-metadata-{baseline,final,lint}.log.
This checkpoint is held locally while PR47 native tests on 3d311360b finish: pushing would automatically cancel those healthy jobs under the existing workflow concurrency policy. Recheck their results before pushing this follow-up; older-source success does not qualify the follow-up.


## Watch-only signing session checkpoint
The staged BIP84 replacement builder now has a watch-only wrapper that always creates an unsigned PSBT using the account fingerprint. It clears both pending and approved signing state before attempting construction and registers only the successfully created exact PSBT. Existing combine verification and exact-hex broadcast authorization apply. No fee-action route is enabled.
Five added session regressions cover valid external Unified signing, rejection of the previous approved transaction, superseded requests, failed construction, enrollment requirements and altered signer outputs. Final four focused suites passed 45 tests; full lint/TypeScript passed with only the inherited encryption warning. Tests mock broadcast; no funds or node RPC used. Logs: /tmp/redwallet-bip84-watch-session-{final,lint,types-final}.log.
Next: fine-grained replacement capability/UI routing (legacy cancel/CPFP must stay blocked), adversarial native tests and independently recorded isolated Knots replacement acceptance. Keep this local follow-up unpushed until healthy native runs on remote 3d311360b finish, to avoid automatic cancellation. Their results do not qualify this newer source.


## October 14: recovered access and stale-screen containment
Verified all exact-source gates on 730b3ffd0ec5d7808f9b6991313242f577f94ab5 succeeded: software38399590431, Android38399590435, iOS38399590466. These are hosted tests, not physical-device or fresh Knots replacement acceptance.
The prior timed-out edit had not landed; tracked files were clean. Added capability checks at entry to BIP84 fee-screen inspection and construction so stale navigation cannot begin either operation. Existing builder and broadcast guards remain. Two focused suites passed15tests; full lint/TypeScript passed with only the inherited encryption warning. Logs /tmp/redwallet-stale-rbf-route-tests.log and /tmp/redwallet-stale-rbf-route-lint.log.
Next acceptance harness located at tests/native/knots-fulcrum-harness.ts in the isolated native-lifecycle branch. It starts fresh regtest directories with peer networking disabled, checks Blake2b activation, records binary hashes and cleans up. Its lifecycle worktree has a pre-existing modified agenda and was left unchanged. Reuse requires review and explicit test binary paths; no new node test has run in this checkpoint.
