# RedWallet Web — XBT watch-only preview

RedWallet's web interface with an ICP/Motoko service and an authenticated
HTTPS bridge to the operator's XBT Fulcrum server. The native RedWallet and
BlueWallet are the feature references. Credit to the BlueWallet team for the
wallet interface and functionality that inspired this project.

## Current capabilities

- Add a watch-only XBT address and retain its label locally in the browser.
- Read confirmed and pending balance, transaction IDs and block heights.
- Copy or display the entered address for receiving.
- Read actual network height, fork checkpoint status and fee estimates.
- Optionally enter a manual XBT/USD conversion rate.
- Keep demonstration wallets explicitly separate from live watch-only data.

History entries do not invent amounts, directions, timestamps or confirmations
that the read-only history API does not provide. An outage does not substitute
sample values for a watch-only wallet.

This version cannot generate or recover a spending wallet, hold wallet keys,
sign transactions, or send funds. It is not a completed replacement for the
native iPhone wallet. Funds can be spent using the separate wallet that owns
the entered address.

## Source layout

- `src/frontend`: React application, existing red design and routes.
- `src/backend`: Motoko bridge client with a pinned configuration operator,
  typed parsing and bounded paid HTTPS calls.
- `src/bridge`: Node bridge, Docker image and transport/security tests.
- `deploy/umbrel`: isolated Umbrel deployment and private configuration helper.

No bridge secret or operator private identity belongs in source control.
The bridge validates the configured XBT checkpoint against exact trusted
extended header bytes obtained from Knots and Fulcrum.

The canister uses a single-replica HTTPS outcall for these watch-only reads.
Displayed data is supplied by the operator's server, not an independently
verified proof of chain state suitable for signing decisions.

## Validation

Run frontend typecheck, tests and build with the scripts in
`src/frontend/package.json`; bridge checks with `npm test` and `npm run build`
inside `src/bridge`; Motoko checks with the project's pinned mops toolchain.
Deployment requires an external HTTPS check and a real canister outcall in
addition to local bridge checks.
