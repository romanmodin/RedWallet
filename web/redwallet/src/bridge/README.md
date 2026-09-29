# RedWallet Fulcrum bridge

A separately deployed, authenticated, read-only HTTP adapter for the operator's
Fulcrum server. The Internet Computer calls its HTTPS reverse proxy; this
process translates fixed bridge methods to Electrum JSON-RPC.

## Runtime and security

- Node 22 or later; no production npm dependencies.
- The HTTP listener defaults to **127.0.0.1**. Terminate public HTTPS at a reverse
  proxy. Both IPv4 and IPv6 literal listener addresses are supported explicitly.
- Every `/rpc` call requires `Authorization: Bearer <BRIDGE_SECRET>`.
- Upstream TLS verifies certificates and never falls back to plaintext.
  Plaintext is allowed only for the literal loopback addresses `127.0.0.1` and
  `::1`; use it when the bridge runs on the same host as Fulcrum.
- The caller cannot select the upstream host or an arbitrary Electrum method.
- There are no key, signing, transaction-building or broadcast endpoints.
- Headers, request and response bodies, timeouts, concurrent work and cache
  memory are bounded. Error bodies never contain credentials or exception text.
- Identical requests are coalesced and cached briefly so IC consensus replicas
  get the same result. Rate limits count unique uncached queries across the
  deployment, independent of replica or reverse-proxy source addresses.

## HTTP contract

`GET /health` reports process liveness, not chain readiness:

```json
{"status":"ok","upstreamConfigured":true}
```

`POST /rpc` requires bearer auth and `Content-Type: application/json`:

```json
{"method":"address.balance","params":["<valid mainnet address>"]}
```

Success is `{"result": ...}`. Failure is
`{"error":{"code":"...","message":"<fixed safe message>"}}`.
Only `method` and `params` fields are accepted; params must be an array.

| Bridge method | Upstream method | Params |
| --- | --- | --- |
| `server.version` | `server.version` | `[]` |
| `server.features` | `server.features` | `[]` |
| `server.status` | `blockchain.headers.subscribe` + `server.version` | `[]` |
| `address.balance` | `blockchain.scripthash.get_balance` | `[address]` |
| `address.history` | `blockchain.scripthash.get_history` | `[address]` |
| `address.utxos` | `blockchain.scripthash.listunspent` | `[address]` |
| `transaction.raw` | `blockchain.transaction.get` | `[txid]` (verbose fixed to `false`) |
| `fee.estimate` | `blockchain.estimatefee` | `[targetBlocks]`, 1–1008 |
| `headers.checkpoint` | `blockchain.block.header` | `[height]` |

Address methods validate mainnet Base58Check or `bc` Bech32/Bech32m, enforce
witness-version checksum rules, derive the correct legacy/witness script and
reverse its SHA256 digest for the Electrum scripthash. Address prefixes alone do
not establish chain identity.

`server.status` returns:

```json
{"height":982345,"serverVersion":"Fulcrum","protocolVersion":"1.4","checkpointVerified":true,"checkpointHeight":961640,"checkpointHash":"<verified operator hash>"}
```

When no checkpoint is configured, the flag is false and both checkpoint fields
are null. A configured checkpoint mismatch blocks **all reads** with
`upstream_malformed`. `headers.checkpoint` returns
`{height, hex, verified, hash}`; `hash` is null for any unverified height.
`fee.estimate` returns Fulcrum's coin/kB number; `-1` means unavailable, not a
negative fee. History contains tx hashes and heights, not transaction details.

### `address.utxos`

`{"method":"address.utxos","params":["<valid mainnet address>"]}` returns the
unspent outputs for the address's derived scripthash:

```json
{"result":[{"txid":"<64 lowercase hex>","vout":0,"height":961640,"value":12345}]}
```

Each entry is validated before it is returned:

- `txid` is exactly 64 lowercase hex characters.
- `vout` is an integer in the uint32 range `[0, 4294967295]`.
- `height` is an integer `>= 0`.
- `value` is an integer number of satoshis in `[0, 2100000000000000]`.

Duplicate `txid:vout` outpoints, non-integer or unsafe numeric values, and any
entry with fields other than `tx_hash`, `tx_pos`, `height`, and `value` are
rejected as `upstream_malformed`. At most **1000** entries are returned; an
upstream response with more than 1000 entries is an explicit
`upstream_malformed` error, never a silent truncation.

### `transaction.raw`

`{"method":"transaction.raw","params":["<64 lowercase hex txid>"]}` returns the
raw serialized transaction hex. The bridge always calls
`blockchain.transaction.get` with `verbose=false`; the caller cannot request a
verbose object.

- The `txid` param must be exactly 64 lowercase hex characters. Non-hex,
  odd-length, empty, uppercase, and wrong-length ids are rejected as
  `invalid_request` before any upstream contact.
- The result must be a nonempty, even-length, lowercase hex string of at most
  **200000** hex characters (100 KB). A verbose object (any non-string) or an
  over-length result is rejected as `upstream_malformed`.

Neither method broadcasts, signs, or touches private keys; the bridge exposes no
such route.

## Checkpoint verification

Provide a height, exact serialized header hex, and corresponding hash from a
trusted node. The bridge fetches `blockchain.block.header` at that height and
compares exact bytes before serving reads. It supports XBT extended headers;
it never assumes the header is 80 bytes and never guesses the chain's hash
algorithm. The operator-provided block hash is metadata, not a locally computed
hash. Successful identity checks are cached for `CACHE_TTL_MS`.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `BRIDGE_SECRET` | required | At least 16 characters; generate 32 random bytes or more |
| `FULCRUM_HOST` | empty | Operator upstream; empty gives `not_configured` |
| `FULCRUM_PORT` | `50002` | Upstream TCP port |
| `FULCRUM_TLS` | `true` | Verified upstream TLS; false only on literal loopback |
| `LISTEN_HOST` | `127.0.0.1` | Literal bind address; `::1` also supported |
| `PORT` | `8080` | HTTP listener port |
| `CHECKPOINT_HEIGHT` | unset | Trusted checkpoint height; all three fields required together |
| `CHECKPOINT_HEADER_HEX` | unset | Trusted serialized header, 80–2048 bytes |
| `CHECKPOINT_HASH` | unset | Trusted 32-byte block hash in display order |
| `REQUEST_TIMEOUT_MS` | `10000` | Upstream timeout |
| `MAX_REQUEST_BYTES` | `16384` | Request body ceiling |
| `RATE_LIMIT_MAX` | `600` | Unique uncached queries per deployment per window |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window |
| `MAX_CONCURRENT` | `8` | Concurrent unique queries |
| `CACHE_TTL_MS` | `15000` | Identical-request cache lifetime, 1000–60000 ms |

The result cache is limited to 256 entries and 16 MiB of serialized results.
Results may therefore lag the upstream by up to the cache lifetime.

## Build and run

```sh
npm ci
npm test
npm run build
# Supply secrets/configuration from a protected environment file.
npm start
```

For an Umbrel host using loopback Fulcrum:

```sh
docker build -t redwallet-fulcrum-bridge ./src/bridge
docker run --rm --network host --read-only --tmpfs /tmp \
  --env-file /path/to/protected/bridge.env \
  redwallet-fulcrum-bridge
```

Set `FULCRUM_HOST=127.0.0.1`, `FULCRUM_PORT=55001`, `FULCRUM_TLS=false`
only after verifying the local listener. Keep `LISTEN_HOST=127.0.0.1` behind
the HTTPS reverse proxy. The container runs as the non-root `node` user and has
no runtime writable data or secrets baked into its image.

Configure the canister with the HTTPS URL and matching secret. Rotate the secret
by updating both deployments. Keep it out of browser bundles, Git and logs.

## Error codes

| Code | HTTP |
| --- | --- |
| `not_configured` | 503 |
| `unauthorized` | 401 |
| `invalid_request` / `method_not_allowed` | 400 |
| `rate_limited` | 429 |
| `payload_too_large` | 413 |
| `upstream_unavailable` / `upstream_tls_error` / `upstream_malformed` | 502 |
| `upstream_timeout` | 504 |
| `internal_error` | 500 |

## Verification

Tests use local TCP/TLS mocks, never a public upstream. They cover authentication,
read-only allowlists, checksum/script vectors, wrong-chain checkpoint rejection,
extended headers, actual tip status, JSON-RPC response IDs, IC fanout coalescing,
rate/size/time limits, and self-signed certificate rejection. Docker image and
real Fulcrum verification are separate deployment checks.
