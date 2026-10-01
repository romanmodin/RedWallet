# RedWallet Web — XBT wallet preview

RedWallet 0.37 is published at https://redwallet-7m3.caffeine.xyz.
It combines a local browser wallet with an ICP/Motoko adapter and an
authenticated HTTPS bridge to the operator's XBT Fulcrum server. Credit to
the BlueWallet team for the interface and functionality that inspired this
project. The native iPhone app is maintained separately.

## Current capabilities

- Watch public XBT addresses and keep their labels on this device.
- Create or recover a local encrypted BIP39/BIP84 account-0 wallet; verify the
  recovery backup, unlock with a password, and lock on leaving or timeout.
- Scan receive/change branches with bounded progress, pause/resume, and saved
  completed balances/history. Switching connections retains completed scans.
- Reserve receive/change indices durably before exposing new addresses.
- Prepare, review, locally sign and broadcast supported XBT P2WPKH payments.
  Preparation checks current coins and parent transactions; changing inputs,
  connection or wallet invalidates the review. Unknown submission outcomes are
  reconciled by txid; payments are never automatically retried or replaced.
- Use the built-in shared relay by default: home Umbrel first, public
  mempool.guide WSS backup. Alternatively connect directly to a personal
  Fulcrum WSS address without deploying a canister. Personal HTTPS adapters
  remain available under Advanced HTTPS adapter.
- Display NeoxEX XBT/USDC quotes or a manual USD estimate. Display estimates
  do not determine transaction amounts or fees.

Keys, recovery phrases and wallet passwords stay in the browser. Public
addresses and signed transactions go to the selected service. Clearing browser
storage removes saved vaults and observations: keep the recovery phrase and
any optional BIP39 passphrase offline. A password alone is not a recovery backup.

## Preview limits

Spending supports native SegWit P2WPKH on BIP84 account 0 only. Taproot,
legacy-input spending, unconfirmed inputs, coinbase inputs, RBF UI and other
accounts remain unsupported. Recovery uses gap 20 by default and1,000 addresses
per branch; selectable bounds are gap 100 and2,000 addresses per branch. A bounded
scan does not prove that no additional funds exist; use the native wallet for
other profiles or larger recovery ranges.

Historical balances are observations, not a current spendability guarantee.
Demo accounts are labelled. Failed reads never substitute sample values.
Checkpoint/parent validation is not a full independent SPV proof. Encryption
at rest does not protect an unlocked wallet from compromised page code.

Version 1.0 remains reserved for a full-featured release. See
[RELEASE-STATUS.md](RELEASE-STATUS.md) for completed checks, evidence and limits.

## Source and deployment

- `src/frontend`: React wallet, direct WSS worker and local signing/vault logic.
- `src/backend`: bounded Motoko HTTPS adapter with a pinned operator.
- `src/bridge`: authenticated Node bridge, transaction validation and quotas.
- `deploy/adapter`: personal WSS/HTTPS and independent backup instructions.
- `deploy/umbrel`: private operator deployment and configuration helpers.

No bridge secret, operator private identity or real wallet secret belongs in
source control. The canister and bridge accept public queries and signed raw
transactions; they do not hold wallet keys. A new canister pointing to the
home bridge does not remove the home-node dependency.

## Validation

Use Node 24 and pnpm 10.14.0 from this directory:

```sh
pnpm install --frozen-lockfile
pnpm --dir src/frontend typecheck
pnpm --dir src/frontend check
pnpm --dir src/frontend test
pnpm --dir src/frontend build
pnpm --dir src/bridge typecheck
pnpm --dir src/bridge test
pnpm --dir src/bridge build
```

The separate `RedWallet Web` GitHub workflow runs these frontend/bridge checks
for web changes; it does not alter native iPhone workflows. Actual compiled
backend tests use the hash-verified isolated runner in `test/pocketic/README.md`;
pure Motoko contracts use `src/backend/test/README.md`. Missing backend artifacts
or infrastructure are never counted as passing tests.
