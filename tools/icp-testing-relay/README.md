# Temporary Fulcrum relay controlled by ICP

Prototype only. No endpoint is deployed or bundled in RedWallet.

The existing wallet connects using Electrum TCP/TLS. A normal TLS relay forwards to one fixed Fulcrum upstream; an ICP Motoko canister grants a temporary lease. A certified update reply, retrieved with dfx on the relay host, controls access. Wallet traffic, private keys, backend hostnames and signing credentials never enter the canister. This is ICP lifetime control, not Fulcrum running on ICP.

The installer selects separate non-anonymous administrator and read-only relay principals and a TTL of at most 30 days. The deadline cannot be extended through the API. An authorized administrator can revoke early or record public iOS and Android production publication receipts. Both receipts permanently deactivate the lease. One receipt alone does not. TestFlight uploads and unsigned Android packages do not count as public publication.

The relay polls every 30 seconds, refuses stale grants after 45 seconds and disconnects existing sockets on expiry, revocation, both publication flags, invalid state or failed refresh. Lease lookups time out after 15 seconds. It bounds clients, per-IP clients, TLS handshake duration, idle time and session lifetime. No traffic logging or dynamic upstream selection is provided. Fulcrum must retain its own protocol-level resource limits.

## Deployment requirements

- Funded ICP canister, administrator principal, separate read-only relay identity and installed dfx. Run dfx under the relay identity on the public relay host; keep the administrator identity off that host.
- Separate public relay host, public DNS and trusted TLS certificate.
- A reachable fixed upstream with a valid TLS certificate. An outbound tunnel from the node to the relay host can avoid opening home ports. This prototype does not configure a tunnel or Tor.
- A release verifier connected to actual App Store and Android publication evidence must call mark_published after each production release. The canister does not independently consult Apple or Google. Automated retirement is not configured yet.

From this directory, start a local replica and build the canister with dfx; use local tests before an IC deployment. For IC deployment use an explicitly chosen administrator principal, read-only relay principal and TTL as constructor arguments. Do not reuse wallet seeds as ICP identities.

The Node relay runs with ICP_CANISTER_ID, TLS_KEY_FILE, TLS_CERT_FILE, FULCRUM_HOST, FULCRUM_PORT, and optional FULCRUM_TLS_NAME / LISTEN_HOST / LISTEN_PORT. It defaults to loopback binding. Expose it through the chosen relay host only after its infrastructure and lease are verified.

## Privacy and limitations

A relay operator can observe client IP addresses and queried wallet activity. The upstream can still observe forwarded script hashes. A cloud relay using a direct connection to a home server exposes that home address to the cloud provider; ICP itself does not hide it. Do not publish a home upstream or assume anonymity.

ICP update polling consumes cycles. If ICP or dfx is unavailable the relay closes, intentionally interrupting wallet connectivity. Shutdown can take up to a polling interval plus the lookup timeout; the freshness guard independently closes stale connections. A malicious relay host/controller can bypass the policy or replace canister code, so this is operator-enforced retirement, not a cryptographic guarantee against its owner.

Run npm ci --ignore-scripts followed by npm test in this directory. Nine checks passed: canister WebAssembly compilation without diagnostics, interpreter publication ordering, irreversible revocation, TTL/owner constraints, unauthorized reads and mutations, strict response parsing, TLS forwarding/retirement and startup failure. Relay tests use a disposable local TLS echo server and fake lease responses. They do not prove live ICP, live Fulcrum, funded wallet or physical-phone interoperability. Deploying this service and adding it to either app still require separate end-to-end checks.
