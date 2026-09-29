/// Static, source-derived API documentation for the RedWallet backend.
///
/// The document is a compile-time literal: it reads no actor state and takes
/// no parameters, so it is safe to include from `main.mo` without threading
/// any stable state through the mixin.
mixin () {
  public query func getApiDoc() : async Text {
    "# RedWallet Backend API\n\n" #
    "Watch-only XBT wallet backend. The canister holds **no keys, no seeds, and no\n" #
    "signing capability**. It exposes read-only address balance/history/fee data\n" #
    "routed through an operator-configured HTTPS bridge, plus non-secret\n" #
    "configuration status. Send, seed and recovery are intentionally absent.\n\n" #
    "## Authentication and identity\n\n" #
    "- Most read endpoints are callable by **any caller, including anonymous**.\n" #
    "  `getAddressBalance`, `getAddressHistory`, `getFeeEstimate`, `getServerStatus`,\n" #
    "  `getBridgeStatus`, `getBridgeOperatorStatus`, `getApiDoc`, `schema` and\n" #
    "  `execute` do not require a signed-in caller.\n" #
    "- The authorization mixin (`_internet_identity_sign_in_start`,\n" #
    "  `_internet_identity_sign_in_finish`, `_initialize_access_control`,\n" #
    "  `getCallerUserRole`, `assignCallerUserRole`, `isCallerAdmin`) manages the\n" #
    "  template's login roles. These roles confer **no bridge authority**: bridge\n" #
    "  authority is independent and controller/operator based.\n" #
    "- The app's frontend pins an Internet Identity derivation origin, published at\n" #
    "  `/.well-known/ii-derivation-origin` when available. An agent already holding\n" #
    "  the user's Internet Identity authorization derives the correct per-app\n" #
    "  principal against that origin (for example\n" #
    "  `icp identity link web <name> --app <host>`). Such a delegation acts with the\n" #
    "  user's full authority in this app until it expires.\n" #
    "- Registration prerequisite: a direct API caller must call\n" #
    "  `_initialize_access_control` once as a signed-in (non-anonymous) caller before\n" #
    "  any role-guarded call, including `getCallerUserRole` and `isCallerAdmin`.\n" #
    "  Admin is **pre-assigned by the operator configuration/migration**, not by\n" #
    "  registration order: the operator principal is pinned at deploy time and\n" #
    "  first-user admin promotion is disabled, so a later caller does not become\n" #
    "  admin by initializing first. Every principal that initializes receives\n" #
    "  `#user`. An anonymous caller to `getCallerUserRole` receives `#guest`;\n" #
    "  a signed-in but unregistered caller traps with `User is not registered`.\n" #
    "  Registration happens only when a caller signs in through the app's own\n" #
    "  frontend, so a principal that never did so is unregistered even when it\n" #
    "  belongs to the app's owner, and a signed-in caller derived against a different\n" #
    "  origin is a different principal than the one the frontend registered.\n\n" #
    "## Authorization boundaries\n\n" #
    "- `setBridgeOperator(operator)` - **canister controller only**. Traps with\n" #
    "  `Unauthorized: controller required` otherwise, and with\n" #
    "  `Operator must not be anonymous` for an anonymous target.\n" #
    "- `setBridgeConfig(baseUrl, secret)` and `clearBridgeConfig()` - **bridge\n" #
    "  operator or canister controller**. Traps with\n" #
    "  `Unauthorized: bridge operator required` otherwise.\n" #
    "- All other endpoints are unrestricted reads.\n\n" #
    "## Read endpoints\n\n" #
    "Every bridge-backed read returns `BridgeResult<T>`:\n" #
    "`#ok(value)` on success, `#err(BridgeError)` on failure. No demo or fabricated\n" #
    "data is ever returned.\n\n" #
    "- `getAddressBalance(address : Text) -> BridgeResult<AddressBalance>`\n" #
    "  `AddressBalance = { confirmed : Nat; unconfirmed : Int }`, both in\n" #
    "  **satoshis**. `confirmed` is non-negative; `unconfirmed` may be negative.\n" #
    "- `getAddressHistory(address : Text) -> BridgeResult<AddressHistory>`\n" #
    "  `AddressHistory = { entries : [HistoryEntry] }` with\n" #
    "  `HistoryEntry = { txid : Text; height : Int; value : ?Int }`. `txid` is a\n" #
    "  64-character hex string. `height` is the block height, or `-1` for an\n" #
    "  unconfirmed transaction. `value` is in satoshis and is `null` when the\n" #
    "  upstream history entry carries no amount - absence stays unknown rather than\n" #
    "  being defaulted to zero.\n" #
    "- `getFeeEstimate() -> BridgeResult<FeeEstimate>`\n" #
    "  `FeeEstimate = { satoshisPerKb : Nat }` - **satoshis per kilobyte**, derived\n" #
    "  from the upstream coins-per-kilobyte estimate for a 2-block target.\n" #
    "- `getServerStatus() -> BridgeResult<ServerStatus>`\n" #
    "  `ServerStatus = { serverVersion : Text; protocolVersion : Text; height : Int;\n" #
    "  checkpointConfigured : Bool; checkpointHeight : ?Nat; checkpointHash : ?Text }`.\n" #
    "  `height` is the current chain tip. `checkpointHeight`/`checkpointHash` are\n" #
    "  present only when `checkpointConfigured` is true; `checkpointHash` is a\n" #
    "  64-character hex string.\n\n" #
    "## Configuration status endpoints\n\n" #
    "- `getBridgeStatus() -> BridgeStatus`\n" #
    "  `{ configured : Bool; checkpointConfigured : Bool }`. `configured` is true\n" #
    "  only when both a base URL and a secret are set. `checkpointConfigured` is\n" #
    "  **time-bounded**: it is true only while the last successful status read is\n" #
    "  less than 5 minutes old.\n" #
    "- `getBridgeOperatorStatus() -> BridgeOperatorStatus`\n" #
    "  `{ isOperator : Bool; operatorConfigured : Bool }` for the calling principal.\n\n" #
    "## Mutation retry safety\n\n" #
    "- `setBridgeConfig` and `clearBridgeConfig` are **idempotent**: re-sending the\n" #
    "  same values leaves the same state. Both reset the connection generation,\n" #
    "  clear the response cache, and clear the checkpoint-verified flag, so a retry\n" #
    "  after a timeout is safe.\n" #
    "- `setBridgeOperator` is idempotent for the same principal.\n" #
    "- Bridge-backed reads are **not** idempotent in the billing sense: each\n" #
    "  uncached read consumes the caller's quota (see below). Retrying a read that\n" #
    "  already succeeded may be rejected once the quota is exhausted.\n\n" #
    "## Lifecycle and polling\n\n" #
    "- Bridge-backed reads are `shared` update calls (they perform an HTTPS outcall),\n" #
    "  not queries. They complete in one round trip and return the parsed result.\n" #
    "- `getBridgeStatus` and `getBridgeOperatorStatus` are cheap queries.\n" #
    "- Safe polling: poll `getBridgeStatus` to learn whether the bridge is\n" #
    "  configured and the checkpoint is fresh. Poll `getServerStatus` to refresh the\n" #
    "  checkpoint flag. Do not poll the balance/history/fee endpoints faster than\n" #
    "  the quota allows; a 10-second response cache absorbs repeated identical\n" #
    "  requests.\n\n" #
    "## Errors\n\n" #
    "`BridgeError` variants:\n\n" #
    "- `#not_configured` - no bridge base URL/secret has been configured by an\n" #
    "  operator yet.\n" #
    "- `#backend_unavailable(Text)` - the bridge was unreachable, timed out,\n" #
    "  rejected authentication, returned a non-2xx status, or the read limit was\n" #
    "  reached.\n" #
    "- `#invalid_input(Text)` - the caller supplied an invalid address or other\n" #
    "  input.\n" #
    "- `#malformed_response(Text)` - the bridge answered, but the response was\n" #
    "  malformed or unexpected.\n\n" #
    "Authorization failures and invalid configuration arguments **trap** rather than\n" #
    "returning a variant.\n\n" #
    "## Non-obvious gotchas\n\n" #
    "- The bridge base URL and secret are **never returned** by any endpoint. Only\n" #
    "  the boolean `configured` flag is exposed.\n" #
    "- `checkpointConfigured` is time-bounded (5 minutes) and is cleared whenever\n" #
    "  the bridge configuration changes or a status read fails.\n" #
    "- Per-caller read quotas apply: 20 reads/minute for a signed-in caller, 60\n" #
    "  reads/minute for an anonymous caller, with at most 6 concurrent reads, 120\n" #
    "  reads/minute overall, and 3000 reads/day overall. Exceeding a limit returns\n" #
    "  `#backend_unavailable` with the message `Read limit reached. Try again later.`.\n" #
    "- Identical bridge requests are served from a 10-second in-memory cache.\n" #
    "- Bridge reads use `is_replicated = false`: a single replica reads the\n" #
    "  operator's server. These are watch-only reads, not consensus-verified\n" #
    "  financial proofs.\n" #
    "- Addresses are validated cheaply before any paid outcall: 14-90 characters,\n" #
    "  alphanumeric only.\n" #
    "- The bridge base URL must use `https://`, must not end with a trailing slash,\n" #
    "  and the secret must be 32-256 printable ASCII characters.\n" #
    "- `transformBridgeResponse` is the IC HTTP-outcall transform; it is an\n" #
    "  infrastructure endpoint, not part of the application API.\n" #
    "- The OQL `schema`/`execute` endpoints expose **no entities**: the actor holds\n" #
    "  only configuration and security state, all of which is secret or\n" #
    "  non-queryable.\n";
  };
};
