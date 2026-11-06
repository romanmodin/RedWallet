# Embedded Lightning Tor work

Started 2026-11-05 on `feat/lightning-tor`, separately from display/channel-status PR #168.

## Verified starting state

- RedWallet main at cca9716 has no Tor runtime, SOCKS bridge, or Tor dependency in its app package/Pod configuration.
- iOS `RegtestNode.connect` validates Lightning endpoints through `MainnetConfiguration.endpoint`, which explicitly rejects .onion.
- LND starts once per process. Changing its transport after startup must not be presented as immediately effective.
- The user's latest phone screenshot reports Synced: yes and Active channels: 1 using a reachable non-onion peer. This does not validate Tor.
- Roman Knowledge searches for RedWallet/LND/Tor returned no records. No Umbrel settings were changed.

## Implementation boundary

Add a managed on-device Tor transport and connect the embedded LND startup configuration to its ready SOCKS endpoint. Merely allowing onion strings is insufficient.

1. Pin and verify the iOS Tor runtime and Android equivalent; preserve license attribution.
2. Start Tor before LND, display bootstrap progress, validate a loopback SOCKS endpoint, and use LND's tor.active / tor.socks configuration.
3. Route Neutrino, Lightning peer connections, DNS, fee retrieval and watchtower connections consistently. Audit the pinned fork rather than assuming all HTTP requests honor the Tor settings.
4. Do not silently switch to direct networking if Tor is selected and unavailable.
5. Validate v3 onion endpoints, keep saved transport/peer settings, and require an explicit app restart when a running engine cannot change transport.
6. Verify an actual onion peer connection, isolated test-fund channel opening/payment, proxy loss, app foreground recovery, and absence of direct-network fallback before advertising support.
7. Existing live channels and wallet data must remain in their current mainnet directory; never recreate the wallet to switch transports.

Primary references:
- https://github.com/lightningnetwork/lnd/blob/master/docs/configuring_tor.md
- https://docs.lightning.engineering/lightning-network-tools/lnd/configuring_tor
- Current pinned fork source already available under /home/roman_modin/redwallet-release-evidence/lnd-mainnet-163/lnd-reference

## Release wording

The current TestFlight build does not support Tor-only Lightning peers. Do not advertise .onion connections as working until the transport and real connection tests pass.


## Implementation candidate, 2026-11-05

The iOS implementation now includes the checksum-pinned Kilombino Arti engine, saved direct/Tor selection, bootstrap before LND, and a restart requirement when changing a running node's transport. Existing wallet and channel directories remain unchanged. Full Tor mode requires iOS 17 or later; iOS 16 retains direct mode. Android Tor support remains pending and its UI does not expose these controls.

The pinned LND fee estimator uses a direct Go HTTP dialer. In Tor mode LND therefore receives a loopback-only fee endpoint. Its fixed HTTPS upstream uses URLSession SOCKS v5 with direct failover disabled and rejects redirects. Proxy failure produces an error; it does not switch transport. This covers embedded Lightning traffic, not unrelated RedWallet networking. iOS can still suspend the process when the phone is locked.

Watchtower settings allow multiple custom towers and a selectable Kilombino onion preset. No tower is automatically enrolled. The interface distinguishes registration, session count, acknowledged updates and pending updates. Acknowledgments do not prove that every current channel state is protected; watchtowers are not payment receivers or recovery backups. Towers must support the same XBT chain and channel features.

Validation includes transport/input/parser tests, UI restart/registration/removal tests, a funded isolated channel/payment test that waits for real watchtower acknowledgments, and a no-funds public Tor sync/onion connection test. The public test also stops the Tor runtime and checks that fee retrieval fails. Native CI and physical-device foreground/lock testing must pass before release. The home Umbrel configuration could not be verified live because sudo requires a password; no home-node settings were changed.

See `docs/lightning-tor-attribution.md` for dependency provenance.


## Candidate test flow

1. Open Tor and watchtower settings, choose Tor for Lightning, and start the node. If it is already running with a different transport, close and reopen RedWallet, then start it again. The saved preference does not change a running engine's connections.
2. Wait for both Tor connectivity and the node's normal synchronization. An onion Lightning peer belongs in Connect Lightning peer; it is not a chain peer or a watchtower address.
3. For a home tower, obtain its separate identity and published endpoint from the node's watchtower info (`lncli tower info` on an appropriately configured LND). The tower service must be enabled, reachable and compatible with this XBT chain. RedWallet does not enable the server remotely.
4. Add that tower or select the Kilombino preset. Check session, acknowledgment and pending counts after channel updates. Registration or zero pending updates alone does not establish protection of every channel state.

The automated funded watchtower test uses an isolated loopback regtest chain. The public Tor test uses no funds and checks synchronization, an onion handshake, fee failure when Tor stops, and restoration of the same local endpoints. A funded channel/payment over Tor and physical-device lock/foreground behavior remain separate device validation items. No claim of uninterrupted iOS background service is made.
