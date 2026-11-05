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
