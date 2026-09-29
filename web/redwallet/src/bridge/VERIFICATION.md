# Bridge verification — read-only spending-data layer

Scope: the two new read-only bridge methods `address.utxos` and
`transaction.raw`, added under `src/bridge` only. No backend, frontend, or app
file outside `src/bridge` was touched. No broadcast, signing, or private-key
endpoint was added.

## Commands and exact results

Run in `src/bridge` on 2026-09-29.

### `npm test`

```
ℹ tests 61
ℹ suites 0
ℹ pass 61
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 702.714009
```

All 61 tests pass, including the new allowlist, validation, bounds, and
server result-shape tests. Upstreams are local TCP/TLS mocks; no real network
is contacted.

### `npm run build`

```
> @caffeine/redwallet-fulcrum-bridge@0.1.0 build
> tsc -p tsconfig.json
```

Exit code 0, no diagnostics.

## What the new tests cover

- **allowlist**: `address.utxos` → `blockchain.scripthash.listunspent`
  (`scripthash`), `transaction.raw` → `blockchain.transaction.get` (`txid`);
  both enforce exactly one param; no broadcast/signing/private-key method is
  present or reachable.
- **validation**: malformed address, bad txid (empty, odd-length, non-hex,
  uppercase, wrong length), unsafe numeric input (NaN, Infinity, non-integer,
  beyond `MAX_SAFE_INTEGER`).
- **bounds**: `address.utxos` rejects negative vout, vout > uint32, negative
  height, negative value, value > 2100000000000000, non-integer value, extra
  or missing fields, and duplicate outpoints; 1001 entries is an explicit
  `upstream_malformed` error (never truncated) while exactly 1000 is accepted.
  `transaction.raw` rejects verbose objects, empty/odd/non-hex/uppercase hex,
  and results over 200000 hex chars.
- **server**: malformed `listunspent` entries and verbose `transaction.get`
  objects map to `upstream_malformed`; a bad txid is rejected before upstream
  contact; no broadcast/signing/private-key method is reachable.

## Not yet verified

The live Umbrel bridge does not yet expose these two methods. The operator will
review, export, and deploy the bridge privately, then verify the actual
canister. No live UTXO or raw-transaction read has been performed or claimed.
