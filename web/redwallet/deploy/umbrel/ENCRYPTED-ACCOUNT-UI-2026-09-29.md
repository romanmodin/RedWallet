# Encrypted account UI integration — pending browser verification

Production v15 remains the verified public baseline. Its Settings observer
received a native enforced CSP event blocking hosting analytics and showed
Connected. Screenshot: redwallet-v15-browser-protection.jpg. The exact259-file
source ZIP matched the v15 export. This closes the production CSP event gate.

This subsequent local source adds gated WalletsPage encrypted create/recover,
24-word backup confirmation, authenticated unlock, bounded account0 receive/
change scanning, integer aggregate balance, deduplicated txid/height history,
and persist-before-display receive rotation. Sending remains disabled. It does
not add a broadcast endpoint or mount the signer. The old global dashboard is
still the selected watched/demo account; the encrypted account view stays
inside Wallets and names the selected local account separately.

Local full suite before final form-expiry/UI regression:45files/288tests passed.
Latest focused private forms:7tests passed, including new synchronous expiry
when a timer is delayed. Receive reservation UI:1test passed. Types/build pass.
Core reservation3tests and account-reader3tests pass; routes/isolation were
included in the full suite. No live encrypted UI or mainnet spend is claimed.

Only published disposable fixtures are used in tests. No real user secret was
retrieved, logged, pasted, uploaded or committed. Plaintext words/passwords are
never persisted. Form fields clear after5minutes, cancel, background or leave.
Unlocked key access independently enforces5minute wall+monotonic deadlines.
Public account reads may continue after key lock; background/unmount cancels.

Each paid account request starts at least3.5seconds apart and times out after
35seconds. An unsettled request prevents starting another after timeout/cancel.
Shared canister quotas can still fail explicitly. A scan is not an atomic
snapshot or proof of no additional funds. Defaults gap20/cap1000 each branch;
explicit gap100/cap2000 options exist. Other accounts/large gaps use native.
Read snapshots are not a spendable balance. Amounts/directions/timestamps of
history entries are not fabricated. No coinbase/unconfirmed spend support.

Public issued indices are bounded untrusted high-water marks, scoped to a
hash of the authenticated xpub; every scan still starts atzero. Addresses are
always derived, never read from storage. Web Locks serializes reservations
across tabs; missing locking or failed write/readback blocks address exposure.
Storage loss can remove these public bounds, so retain the offline backup and
use extended/native recovery as needed. No storage deletion UI is provided.
