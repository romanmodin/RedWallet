# Read-only spending-data deployment

Caffeine v10 source exported and merged against preserved v9. Newer vault deadline fix e2f269346 preserved. Review fixed unsafe UTXO height acceptance in bridge to Number.isSafeInteger and added regression. Corrected PocketIC coverage description: 13 compiled-canister tests cover validation/auth/unconfigured/API docs; successful outcalls were not tested there.

Local full frontend: 217 tests / 31 files passed; typecheck passed. Clean bridge test compilation: 67 tests passed; build passed. Caffeine v10 reported 215 frontend,61 bridge,13 PocketIC tests; retained report describes platform results. Local bridge includes earlier extra security tests.

Umbrel bridge updated in place with same compose, ports, credentials and checkpoint at 2026-09-29T19:31Z. Image sha256:a384b17ce77a4f5d2e1d61bae90201fe218be4aee4d0b1fb6291f9dbd0225e42. Container healthy; HTTPS health200 and unauthenticated RPC401.

Draft canister uxwok-mqaaa-aaaad-qi6ua-cai probe passed 2026-09-29T19:32:27.201Z: height974736, exact XBT checkpoint961640, public BIP84 address balance0/0, history176, fees1000sat/kB, UTXOs empty, raw transaction fd4b2c20cea81c2319f460114d2303b2dc3494524cc07cde015eebb38033cdcd returned175 bytes; malformed txid rejected. This confirms actual HTTPS canister reads, not funded UTXO selection or broadcasting.

Rollback source: /home/umbrel/redwallet-bridge/backups/bridge-before-spend-data-20260929T191936Z.tar.gz. Rollback image tag redwallet-fulcrum-bridge:before-spend-data-20260929t191936z (sha256:f937d5265b1fcd4e00d0fb814f775b3f07d6dbf2e50602c67df588b9395010c7). Umbrel repository directory is archive source, not a Git checkout.

Production remains v7 watch-only pending promotion. Caffeine is building next narrow fix revision; user seed/sign/send UI still disabled. No real funds moved.
