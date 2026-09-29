# Read-only spending-data verification

Non-secret record of the read-only spending-data layer added to RedWallet. It
contains no bridge URL, bridge secret, operator principal, draft access-token
URL, seed, or private key.

## What this layer adds

- **Bridge methods (backend, read-only):** `address.utxos` and
  `transaction.raw`, exposed by the canister as
  `getAddressUtxos(address : Text) -> BridgeResult<AddressUtxos>` and
  `getRawTransaction(txid : Text) -> BridgeResult<RawTransaction>`. Both are
  read-only; the canister holds no keys and cannot spend.
- **Frontend service seam:** `BridgeWalletService.getAddressUtxos` and
  `BridgeWalletService.getRawTransaction` in
  `src/frontend/src/services/bridgeService.ts`, returning
  `ServiceResult<AddressUtxos>` / `ServiceResult<RawTransaction>` and never
  throwing to the UI.
- **Discovery overlay import:** the isolated `discoverAccount` module under
  `src/frontend/src/lib/xbt/discovery.ts` consumes a caller-supplied history
  probe; it is not wired to any route or service.

## Bounds and validation rules

Frontend (`bridgeService.ts`):

- `getAddressUtxos`: trims the address; an empty address is rejected as
  `invalid_input` before any bridge call. A configured bridge is required
  (`not_configured` otherwise); a missing actor is `backend_unavailable`.
- `getRawTransaction`: trims the txid and requires exactly 64 lowercase hex
  characters (`/^[0-9a-f]{64}$/`); anything else is `invalid_input` before any
  bridge call.
- Both adapters map a `BridgeError` err result through `mapBridgeError`:
  `not_configured` → `not_configured`, `backend_unavailable` →
  `backend_unavailable`, `invalid_input` → `invalid_input`,
  `malformed_response` → `unknown`. A thrown actor call becomes
  `backend_unavailable`.

Backend (`src/backend/lib/bridge.mo`, `mixins/bridge-client.mo`):

- `validAddress`: 14–90 alphanumeric characters; the bridge verifies the full
  checksum and network.
- `isLowerHex64`: exactly 64 lowercase hex characters.
- `parseAddressUtxos`: rejects duplicate JSON fields, non-integer/unsafe
  numbers, negative heights, `vout` outside `0..4_294_967_295`, values outside
  `0..2_100_000_000_000_000`, duplicate outpoints, and more than `maxUtxos`
  (1000) entries — never a silent truncation.
- `parseRawTransaction`: nonempty, even-length, lowercase hex of at most
  `maxRawTransactionHex` (200,000) characters; verbose objects are rejected.

## Commands run and exact results

Run from the project root on 2026-09-29. Every command below exited 0.

### Full suite — `pnpm test`

`pnpm test` runs three lanes in sequence: the frontend vitest suite, the bridge
node:test suite, and the backend PocketIC lane. All three ran and passed.

**Lane 1 — frontend vitest (`pnpm --dir src/frontend test`, jsdom):**

```
 Test Files  31 passed (31)
      Tests  219 passed (219)
   Duration  28.90s
```

The new file `src/test/bridge-spending-data.test.ts` contributes 18 tests
covering both adapters (ok, whitespace trim, empty/invalid input, all four
`BridgeError` mappings, thrown-actor, and no-actor paths) plus the
read-only/unwired invariant scan.

**Lane 2 — bridge node:test (`pnpm --filter @caffeine/redwallet-fulcrum-bridge test`):**

```
ℹ tests 67
ℹ pass 67
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 758.626079
```

67/67 pass, 0 fail. This includes the new `address.utxos` and
`transaction.raw` cases: malformed listunspent entries, >1000 entries as an
explicit error (not a truncation), exactly 1000 entries accepted, verbose
objects and malformed hex rejected, bad txid rejected before upstream contact,
and the allowlist invariant that no broadcast/signing/private-key method is
reachable. (An earlier revision of this file recorded 61; the suite has since
grown, and the count above is the one observed when the suite is run in this
environment.)

**Lane 3 — backend PocketIC (`pnpm run test:backend`):**

The lane ran (it did not decline): the sidecar was reachable and the compiled
`src/backend/dist/backend.wasm` was installed into a real PocketIC replica.

```
> @caffeine/template-app@ test:backend /home/ubuntu/workspace/app
> node test/pocketic/run-backend-lane.mjs

 RUN  v3.1.4 /home/ubuntu/workspace/app/test/pocketic

 ✓ backend.test.ts (13 tests) 544ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Duration  879ms
```

13/13 pass. Overall `pnpm test` exit code 0.

### Typecheck — `pnpm typecheck`

```
src/bridge typecheck: Done
src/frontend typecheck: Done
```

Exit code 0.

### Build — `pnpm build`

```
src/bridge build: Done
src/frontend build: Done
```

Exit code 0. (The frontend build prints a non-fatal Browserslist
`caniuse-lite` age notice; it does not affect the build result.)

### Backend PocketIC lane detail

The lane file `test/pocketic/backend.test.ts` has 13 tests, all passing, and
exercises the real compiled canister. Its coverage is deliberately bounded:
input validation, authentication/authorization, the unconfigured state, and
API-docs paths. It does **not** cover the successful outcall parser paths —
the configured-but-unreachable outcall cannot complete under PocketIC's ingress
budget. The successful `parseAddressUtxos`/`parseRawTransaction` paths are
covered by pure Motoko unit tests, and actual live probes follow privately.

New tests added for the two read-only methods:

- `getAddressUtxos` and `getRawTransaction` return `{ err: { not_configured: null } }`
  when the bridge is unconfigured, matching the existing not-configured pattern.
- `getAddressUtxos("")` returns `{ err: { invalid_input: "invalid address format" } }`
  before any upstream call.
- `getRawTransaction` rejects empty, non-hex, odd-length, wrong-length, and
  uppercase txids with `{ err: { invalid_input: "invalid transaction id" } }`.
- A non-operator caller (a principal never promoted to operator) cannot
  configure the bridge or appoint itself operator, and the new reads return the
  explicit not-configured error rather than succeeding.
- `getApiDoc` mentions `getAddressUtxos` and `getRawTransaction` and states
  there is no broadcast, signing, or private-key endpoint.
- No bridge URL or secret leaks through the new read error paths.

### `mops check --fix`

```
✓ backend
✓ Stable compatibility check passed for canister 'backend'
✓ Lint fixes applied
```

Exit code 0.

### `mops build`

```
build canister backend
check deploy canister backend

✓ Built 1 canister successfully
```

Exit code 0.

### `pnpm bindgen`

```
[caffeine-bindgen] Generating bindings from ./src/backend/dist/backend.did
[caffeine-bindgen] Bindings generated at ./src/frontend/src
```

Exit code 0. Generated bindings were refreshed from the built `.did`; no
generated file was hand-edited.

## Live-bridge status

The live Umbrel bridge does **not** yet expose `address.utxos` or
`transaction.raw`. No live UTXO read and no live raw-transaction read was
performed or claimed. The operator will review, export, and deploy the bridge
privately, then verify the actual canister afterward. Until that verification,
these methods are service-layer capabilities only and are not wired into any
page, hook, or context.
