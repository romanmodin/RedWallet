# RedWallet0.37: iPhone confirmation and regression follow-up

At2026-10-01 11:12PDT, user confirmed0.37 resolved automatic Keychain
password zoom on their iPhone. This supersedes prior pending-phone notes.

Live public0.37 was reloaded and verified, browser analytics blocked, and
built-in home bridge Test connection returned connected. These are read-only
checks; no wallet transaction or operator configuration changed.

Initial full frontend run:63files,381passed/1failed of382. AccountReadPanel
receive/refresh test read the parent snapshot before busy-finally and passive
effect restored it after a failed refresh. Error text can appear earlier.
The test now waits for the original snapshot notification plus the enabled
Refresh account control. Assertion is preserved, not skipped or weakened.
Focused two-case file PASS; Biome219 PASS. Product runtime code unchanged.
Final full suite:63files/382tests PASS,80.85seconds, exit0.
Typecheck and Biome219 PASS. Log retained at
/workspace/scratch/7be288640ecb/redwallet-037-full-frontend-final.log. This test/docs-only follow-up needs no new product
version or Caffeine publication. Prior bridge80/backend25/Motoko16 verification
remains applicable to the unchanged artifacts; these lanes were not rerun.
