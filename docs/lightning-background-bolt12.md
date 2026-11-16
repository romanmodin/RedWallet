# Lightning background grace and BOLT12

## Behavior

A running embedded iOS node requests one UIKit background assertion when the app
leaves the foreground. RedWallet releases it on return, OS expiration, or after
25 seconds, whichever happens first. Denial/expiration never renews the lease,
stops the daemon, closes a channel, or retries a payment. The OS may grant less
time. This is a short completion window, not continuous background availability.

BOLT12 uses the existing checksum-pinned iOS Lndmobile engine (Kilombino/lnd
cae303b36594a2c48c9ce0cbb238672e3a1b284e, ios-engine-21.2), which already exports
offersrpc. No engine replacement or channel migration is included.

Receive supports reusable fixed or payer-chosen whole-sat offers, QR/copy/share,
listing and enabling/disabling. Keep the app open to receive. Disabling an offer
does not revoke invoices already issued.

Pay accepts an XBT offer. Native decoding checks validity/chain/features; fetching
uses the engine's verified offer-to-invoice exchange. The native review binds the
fetched invoice, amount, issuer, fee ceiling and a one-use five-minute token.
Payment uses only that invoice, never PayOffer's fetch-and-pay shortcut.
BOLT12 fee limits must be at least one sat because this engine interprets zero
as its default fee allowance. Sub-sat, quantity-priced and direct lni/lnr inputs
are not supported by this initial UI. Android's current engine build omits
offersrpc, so the new controls are gated on the iOS native method.

## Interrupted payments

One atomic, protected, backup-excluded native journal retains the fetched invoice
and records submission before LND is invoked. A second review reuses that invoice.
Different offers/amounts require an explicit Start new offer payment action.
After submission, that action requires LND's authoritative terminal settled/failed
state; pending, missing, unknown or unavailable history keeps the record.
Resume saved offer payment restores the hash for status checking after reopening.
Malformed/unreadable journal data fails closed. RPC errors do not erase it.
If termination occurred after journaling but before LND recorded the payment, a
freshly reviewed, explicitly confirmed retry can pay only that same invoice/hash;
LND deduplicates it. Missing submitted history still forbids reset or refetch.

## Verification

Local focused JS/UI tests, full TypeScript and lint must pass. Native XCTest covers
background expiry/denial/stale callbacks, invoice binding and durable journal
behavior. The existing isolated iOS regtest tier additionally pays an offer through
a disposable peer, receives an offer payment, checks one-use/same-invoice review
and toggles the receiving offer. The peer build enables offersrpc for these tests.

Simulator compilation, funded regtest and physical iPhone background observation
must be reported separately. No mainnet payment, signing/upload, or TestFlight
availability is established by local tests or a bot review.
