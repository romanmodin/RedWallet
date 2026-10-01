# RedWallet 0.33 automated release checks

Scope: published 0.33, implementation 6058ec0a5, initial verification baseline c2fdd2828.
User requested every available automated check. Native iPhone app, production
wallet keys and real financial submission remain outside these tests.

## Automated lanes

| Lane | Result | Evidence scope |
| --- | --- | --- |
| Frontend Vitest | 61 files, 364 tests PASS | Entire suite, no exclusions; recovery, tampering, lifecycle deadlines, saved observations/drafts/receipts, provider-generation rejection, signing/review/dispatch, direct worker and public fixture coverage |
| HTTPS bridge Node tests | 80 tests PASS | Real local server tests plus bounded parsers, method allowlist, auth, request quotas and explicit broadcast gates |
| Actual compiled backend PocketIC | 2 files, 25 tests PASS | Hash-verified current Wasm and current test-source digests on isolated Zorin replica; no production outcalls |
| Standalone Motoko contracts | 1 file, 16 tests PASS | Native moc 1.16.0, Mops 3.4.1, locked dependencies and byte-identical source copies; both oversized fixtures included |
| Frontend typecheck/Biome/build | PASS | 216 files checked; production Vite build |
| Bridge typecheck/build | PASS | TypeScript and emitted bridge build |
| Fresh offline signer build | PASS | Current harness produces exactly the previously node-tested XBT and Bitcoin signed fixtures, byte-for-byte; this is fixture replay, not a fresh node run |

Total 485 automated test cases passed. Frontend browser-bundle check runs without
Node Buffer/process/require globals. Existing ancestor React Native config and
stale Browserslist warnings remain; neither failed the checked build.

PocketIC uses the actual published compiled Wasm SHA256
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001.
Current backend test sources matched cache copies before execution:
backend.test.ts ee908b06abfef5e812869f35093ff01ec1cd3cb3fdce89173a324cdccef2159d;
provider-outcalls.test.ts 84205cc1bacab2ffcb552bdecb64531ece621bb4a947606be6bddca850f7dcfb.
Zorin log: /home/roman_modin/.cache/redwallet-pocketic-028/release-033-tests.log.

## Published browser checks

Desktop Chrome on actual production app, using only the published BIP84 public
test phrase and dummy password, never the user's wallet. Built-in wallet self-test
passed. Recovery saved encrypted vault, wrong password rejected, correct unlock
produced expected account-0 address bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu.
Reload retained the vault and locked keys; unlock recovered the same identity.
Navigating to Settings also locked the workspace controller.

Plain ws:// rejected before connection. Home WSS Test and validated Save passed
at block 974955, without shared relay. After waiting for Saved, full reload
retained selected direct WSS and endpoint; return-to-built-in selection worked.
An initial test reload was intentionally corrected to wait for the asynchronous
Save acknowledgment; that premature reload is not a persistence failure claim.
Bounded live discovery passed: 82 addresses checked, zero balance observation,
existing public fixture history retained, completed at 2026-09-30 21:11:26 PDT,
block 974957. Pause at 12 checked and Resume preserved progress. The five-minute
key deadline visibly locked the vault while public discovery continued.

Switching WSS to shared relay, unlocking, and then a full reload/unlock retained
all displayed account-history text exactly, 82 checked addresses, original scan
time and block; no active scan/Resume/Pause control appeared. These are actual
published browser checks, supplementing the mocked frontend provider tests.
Explicit reconnect also retained the exact displayed history and 82 checked
addresses, with no new discovery scan. Public shared service Connected after
reconnect. Screenshot redwallet-033-recovery-result.jpg records count, original
scan timestamp/block and connected state. No private wallet was accessed.

## Remaining device/infrastructure checks

Actual iPhone Safari background/reopen behavior requires the user's device;
Chrome and jsdom do not prove Safari behavior. User already reported a successful
send and confirmation on 0.32; provider was unspecified and no new transaction
was independently inspected. No new funded payment is required for these checks.
The user reports 0.33 splash works on laptop but not phone, even private browsing;
user deferred this cosmetic issue.

The previously unavailable standalone Motoko lane is now resolved. Installed
Mops 3.4.1 and pinned native moc 1.16.0 in workstation caches, without changing
production source, dependencies or canister configuration. All 16 tests passed
both the direct native compiler run and the repeatable command
`mops test bridge --locked --mode interpreter --reporter verbose`. The latter
reported 16 passed in 190.02 seconds; saved process status records exit 0 and
192.61 seconds including CLI startup. Tests were not excluded or reduced.
The >1000-UTXO and oversized raw-transaction fixtures both passed. Before
execution, source copies and the original manifest/lock matched byte-for-byte;
`mops install --locked` also verified dependency integrity.

Source digests: bridge.mo
f486125dea8522787f5ddeb8ee0a386cb240734cb4e925e19a653b591d058b53;
types/bridge.mo
057ecb014a73c401dfbf86b247edaf53775ecda6a5097a71c800faa99fcb8e24;
bridge.test.mo
7b35d4f2bc5f00f63b264eef8bce489326a2e155bf2188c635a77b74f13fbfde.
Logs/status live under
/home/roman_modin/.cache/redwallet-motoko-033/mops-pure-tests.log and
mops-pure-status.json. See src/backend/test/README.md for reproduction.

An exploratory WASI run failed at compilation because the implicit core Random
APIs contain async expressions unsupported by that runtime/compiler mode. It
ran zero assertions and is not counted as a pass. No production flags or fixtures
were changed to accommodate it. Native execution resolves the missing contract
lane; PocketIC separately checks the published compiled backend. No new regtest
nodes were started; prior node-acceptance evidence is retained and current
signed-fixture bytes match.

BUILTIN_BACKUPS remains empty. Synthetic independent-failover tests pass, but no
independently hosted XBT adapter has been provided or deployed, and real outage
redundancy is unverified. This verification-only pass does not change the product
version or require another Caffeine publication.

Independent deployment requirements and acceptance steps are prepared in
deploy/adapter/INDEPENDENT-BACKUP.md. Saved infrastructure notes contain no
independent host; a host, synced node/index, public HTTPS endpoint and separately
configured canister are needed before live backup verification or registration.
