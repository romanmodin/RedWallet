# Caffeine v9 foundation verification

The existing v7 project was continued, not restarted. Caffeine published v8 and
then v9 previews during one foundation import. Live production remains v7.

The v9 export was recovered as `redwallet (5).zip` and compared with reviewed
commit 81dbe45ab. Crypto-module differences are import ordering, type-only imports
and a test template literal. Caffeine added three static isolation tests and
AGENTS learnings. Lockfile changes remove libc/deprecation metadata; package
versions and integrity values did not change. No bridge, backend, route,
component or donation behavior changed in this revision.

Caffeine reports: 190 frontend tests / 29 files passed; 48 bridge tests passed;
9 tests against the compiled backend passed; typecheck and production build
passed. These counts are the platform's report, not retained raw logs.

Independent local verification after merging the reviewed v9 changes with the
new discovery code: 50 focused XBT/isolation tests passed; TypeScript passed.
Before the v9 formatting/isolation additions, the full discovery suite passed
194 tests / 29 files. Do not conflate those two runs into an invented full-suite
count. Fresh independent node acceptance/replay evidence is under test/regtest.

Production canister 7gylz-gyaaa-aaaab-qhjrq-cai was independently checked at
2026-09-29T18:53:22.163Z: height 974732, configured checkpoint height 961640/hash
0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb;
public BIP84 fixture balance 0/0, history 176, fee 1000 sat/kB.

Seed creation, recovery, signing and sending UI are still disabled. The next
Caffeine step imports discovery and adds bounded read-only UTXO/raw-parent APIs.
Its deployment and live Umbrel bridge compatibility must be verified separately.
Native app worktrees, bridge secrets/operator identity, and existing private
Tailscale/mining ports were preserved.
