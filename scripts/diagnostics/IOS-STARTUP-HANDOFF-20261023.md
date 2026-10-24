# iOS startup diagnosis handoff

Status: local candidate; no native iOS qualification or new delivered build.
The latest evidence is `IOS-KILOJOIN-INITIAL-HISTORY-20261023.json` under
`.github/release/`. Earlier records there retain each pre-fix failure.

## Restore and reconcile

1. Verify Zorin device `b21a1074-5b54-465c-a355-fdecb7995283` is online and the
   existing owner `gh` works. Inspect worktrees, local changes, remote PRs and
   active jobs before transferring anything. Preserve all unrelated work and
   `node_modules`; do not update a branch with healthy active native runs.
2. Import the verified local diagnosis branch into a new isolated worktree.
   The prepared branch is `fix/kilojoin-native-diagnosis-20261023`, based on
   main `e262f0fb31be8c704e847d86b337b311701492e1`. Compare actual current main;
   do not overwrite or silently discard any newer work. Verify the transferred
   commit and tracked production mapping against the saved local receipt.
3. Review the cumulative production diff, not only the last vote-order fix.
   This branch includes compatibility, native UTF-8 decoding, replay ordering,
   Stop cleanup, bounded vote queues, diagnostics and the requested coin-circle
   explanation/skin work as recorded in its commit history. Qualification must
   cover the actual final source; previous source passes cannot be reused.

## Required native qualification

- Run the unchanged software CI, general iOS and funded-regtest iOS gates on
  the exact candidate. Verify repository, workflow, source, current attempt and
  each required job. Skipped runs do not pass.
- The existing offline native Kilojoin self-test exercises actual Kotlin
  welcome/roster/vote envelopes in both script types and both arrival orders,
  using native entropy, encrypted storage and Keychain cleanup. Verify it
  actually executes within the native self-test screen. Retain failure details
  without private wallet data. The standalone Linux Hermes results do not
  replace this step.
- Inspect actual iPhone screenshots and sanitized startup-stage diagnostics.
  Confirm the real app advances from welcome to a verified participant roster,
  handles replay, and preserves the reservation/Stop rules. Do not use the
  user's real coins as an automated test fixture.
- If a gate fails, retain its first actionable evidence and fix the bounded
  cause before qualifying a new source. Never remove the failing safety check
  or relabel an older pass as current.

## Delivery

After all required qualification, follow the existing guarded merge and
protected signing/upload flow, checking duplicates and exact source pins.
Verify the real IPA, Apple processing and existing tester-group membership
before calling a build available. Follow the user's wallet-first Apple review
priority using fresh Apple state and receipts; no legal agreement acceptance
without action-time authorization. A local fix is not a new TestFlight build.

The original physical-phone error has not yet been observed under diagnostics.
The found failures are reproducible defects, not proof that every one happened
in the user's round. Do not ask the user to repeatedly retry real-fund joins.
