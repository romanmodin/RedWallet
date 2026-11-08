# Add or remove channel funds

The iPhone channel list has Add funds and Remove funds controls for channels
whose native LND splice status permits resizing. Both peers must support the
same XBT splice protocol and be online. This is manually reviewed, not an
automatic balance sweep.

Add funds uses confirmed funds in the Lightning node’s on-chain wallet. Remove
funds returns funds to an address of that same wallet, shown before confirmation.
The existing withdrawal controls can then send them elsewhere. The peer’s funds
are not available to remove.

Enter an explicit positive whole-sat amount and fee rate. There is no RedWallet
beta spending ceiling. The monetary range and integer-overflow checks remain;
LND applies the actual spendable-balance, minimum amount, dust, reserves and
peer constraints. Large channels are enabled, subject to the peer's support.
Review uses LND EstimateSplice, without leasing coins or contacting the peer.
It shows the amount, estimated fee, fee rate, resulting capacity/local balance,
return address for removals, and required confirmations. LND may impose a
higher minimum amount, fee floor, reserves or other channel restrictions.

Confirmation consumes an expiring native token binding the exact request,
checks channel readiness and re-estimates before one SpliceChannel call.
Changed estimates require a new review. No use-max or force-low-fee option is
set. The fee is an estimate; the fixed fee rate is submitted to LND.
The first stream update means the attempt started, not that it completed.
Channel polling shows native pending/last splice progress and confirmation
counts. LND owns persistence and disconnect/restart recovery. A timeout never
triggers a second submission. Check the native channel state before another
action after an unknown result.

Automated native validation uses disposable keys and regtest funds. Tests are
added for both directions, review without broadcast, duplicate confirmation
rejection, confirmation/lock progress, capacity changes, backup and the existing
payment/withdrawal/recovery flow. They must pass before release; writing these
tests does not establish physical-device or uninterrupted background operation.

New channel openings accept an explicit amount up to **10,000,000 sats** and a
funding fee rate; both are shown in the confirmation. The opening cap is enforced
in the UI and both native bridges, and does not cap subsequent channel resizing. Invoice creation, decoding/payment and withdrawals
share the same monetary-domain validation without the former 1,000,000-sat cap.
Routing fees remain an explicit reviewed budget, editable without the former
fixed 10-sat ceiling (including zero for a fee-free route). A running node needs
an app restart to load the updated large-channel configuration. The other peer
must also support the requested channel size.

Tapping the Lightning wallet balance cycles XBT → sats → quote currency (NeoxEX
USDC) → hidden amounts → XBT. Hidden mode persists with the wallet's existing
hide-balance preference and masks balances, the funding/channel breakdown,
fiat estimate and activity amounts on the wallet home and its main-menu card.
Payment entry and confirmation still use explicit amounts in sats.
