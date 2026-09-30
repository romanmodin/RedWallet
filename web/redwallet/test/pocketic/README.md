# Backend integration verification

The normal `run-backend-lane.mjs` uses the platform's existing PocketIC sidecar.
It can skip for unavailable infrastructure. A skipped lane is never a passed
application test. Leave that runner's deployment behavior unchanged.

For explicit workstation verification, `run-isolated-backend-lane.mjs` starts a
temporary local PocketIC process and stops it after the serial tests. It requires
the compiled backend Wasm and its expected SHA256; a mismatch or failed test
exits nonzero. Do not run this workstation lane inside the production canister
container. Install the repository's pinned `@dfinity/pic` and Vitest dependencies
first. PocketIC's replica workers require Unix sockets supported by the host.

```sh
node test/pocketic/run-isolated-backend-lane.mjs \
  /absolute/path/to/backend.wasm \
  6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001
```

That digest is the exact artifact exported from published Caffeine revision 30,
RedWallet Web 0.28. A newer revision requires its own reviewed digest and matching
generated declarations. Do not substitute an older generated `dist` artifact.
Compiled Wasm, caches, replica state and binary dependencies are not committed.

`backend.test.ts` checks the actual compiled API's authentication, input,
unconfigured state and transforms. `provider-outcalls.test.ts` executes provider
and price methods with deterministic PocketIC HTTPS responses, checking request
routing, checkpoint and time rejection, changes during pending calls, token
non-disclosure, fixed-price endpoint isolation and successful/failed price cache
throttling. The test token is a public dummy fixture, never a deployment token.
No live bridge, identity file, private wallet or funded broadcast is used.

These tests supplement live read-only checks. They do not prove independently
hosted service availability, real backup failover, Safari background behavior or
additional transaction formats.
