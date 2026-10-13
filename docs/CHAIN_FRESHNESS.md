# Nonblocking XBT chain freshness

The wallets-list header performs an advisory cross-check on mounting/foreground return and hourly while active. A disagreement is retried after two minutes. No new block is required. Recent serialized headers are compared six blocks below the lower tip; up to two blocks of propagation lag is allowed.

The indicator identifies Fulcrum/Shulcrum from its server greeting, otherwise uses “Electrum”. Offline access, receiving addresses, cached history, signing rules, and the selected server are not changed. Status details identify the evidence source, heights and verification time. A home-only match is explicitly labeled “Matches your Knots”. If a reachable public reference is ahead, agreement between two stale home services does not override the warning. This cross-check is not full SPV validation and public endpoint availability is not guaranteed.

The built-in `https://mempool.guide/api/` reference receives only public heights/block hashes. An optional HTTPS metadata endpoint can be linked to the active Electrum host/port under Settings → Network → Electrum → Chain freshness checks. References are never wallet providers and cannot become silent fallbacks. Native Knots RPC URLs, credentials, wallets, addresses, transaction IDs and balances are not sent to reference endpoints.

## Optional home endpoint

`scripts/knots-chain-reference.py` is a standalone, loopback-only example for an Umbrel XBT node. It returns only `{height, comparisonHeight, header}` for `GET ?height=<height>`. It uses fixed read-only `getblockcount`, `getblockhash`, and `getblockheader` commands in the configured Knots container. Only the fork checkpoint and last 4096 blocks are allowed; arbitrary RPC, wallet parameters and POST are rejected. A bounded concurrent-request limit, response cache, subprocess timeout and connection timeout limit resource use.

Host it behind your existing HTTPS proxy, preserving authentication/other routes as appropriate. The endpoint intentionally contains only public chain metadata; do not expose Knots RPC or its credential files. The supplied container name/port must be reviewed for the operator's deployment. Configure the endpoint explicitly in the app; no personal home host is hardcoded into RedWallet.

## Qualification

Policy/network/lifecycle tests cover unchanged tips, either reference being available, both home services stale, two-block grace, repeated disagreement, public reference fork mismatch, offline states, late-provider results, no wallet-data reference queries, every-open/hourly scheduling, background suspension and nonmodal header interaction. Normal wallet transaction checks remain authoritative.

Native on-device header layout, TLS endpoint reachability and foreground/resume behavior must still be checked in the actual signed beta. Source/unit verification does not install an update on the user's phone.
