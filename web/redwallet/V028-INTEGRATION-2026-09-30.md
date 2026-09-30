# RedWallet Web 0.28 — PocketIC verification completed

The published Caffeine revision 30 backend artifact was extracted from the exact
compiled export `redwallet (25).zip`. It is 690890 bytes, SHA256
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001.
Its hash was verified before transfer and on Zorin before execution. Matching
generated declarations came from the saved 0.28 branch. No replacement compiler
artifact was substituted.

## Result

25 PocketIC tests in two files passed on Zorin at 2026-09-30 15:25:12 PDT
(22:25:12 UTC). The committed isolated runner executed all 25, exited successfully
and stopped its local PocketIC process. The artifact mismatch check also passed:
an incorrect expected digest exited nonzero before replica creation.

- Existing 14 compiled-canister tests passed: operator isolation, invalid input,
  unconfigured reads/broadcast, no first-user promotion, API docs and transforms.
- Eleven new actual compiled-canister tests passed: unconfigured provider info,
  correct HTTPS identity route and token non-disclosure, wrong checkpoint, stale
  and future tip, height below pin, missing tip metadata, configuration changes
  while a reply is pending, failed HTTPS response, isolated fixed NeoxEX endpoint,
  and successful/failed price-call cache throttling.
- New test TypeScript check and runner syntax check passed. Deterministic
  PocketIC response injection exercised the real canister methods, not frontend
  actor mocks. The dummy token is a public test fixture.

The scratch execution environment's instance-creation timeout was reproduced and
diagnosed: PocketIC's replica worker panicked with PermissionDenied while binding
a Unix socket. Ordinary loopback HTTP still worked. Zorin's Unix socket test
passed and the replica successfully created instances there. No production
settings, node containers, native worktrees or signing code were changed.

## Reproduction and scope

Use `test/pocketic/run-isolated-backend-lane.mjs` with the exact reviewed Wasm and
expected digest; see `test/pocketic/README.md`. This is an explicit workstation
runner. The existing platform sidecar runner and its skip behavior are unchanged.
Missing infrastructure never counts as a passed test. Workstation dependencies
were installed from pinned official npm packages in
`/home/roman_modin/.cache/redwallet-pocketic-028`; artifact, generated declarations,
fixture tests and final log `verified-isolated-tests.log` are retained there.
No identity or deployment secret was read by the tests.

The open 0.28 PocketIC execution gate is now passed for these 25 tests. The earlier
JS Motoko interpreter overflow is a separate verification limitation and has not
been represented as a passing pure-unit run. No independently hosted backup is
configured; actual production failover remains unverified. Safari background/
reopen behavior still needs user testing. The app remains 0.28 because these
changes add verification only; no product publication is needed.
