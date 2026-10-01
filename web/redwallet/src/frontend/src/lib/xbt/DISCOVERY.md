# Public account discovery

`discoverAccount` uses the native RedWallet BIP84 account-0 receive and change
branches with a default gap of 20 addresses without transaction history.
The caller supplies a history probe; this module never contacts a server itself.
The current account reader integrates it into the published local wallet scan.

Any activity counts, including a fully spent address or unconfirmed transaction.
The caller must reject failed, malformed or incomplete history reads instead of
returning false. Discovery rejects on a failed read, cancellation, or exhaustion
of the address cap; it never returns a partial result as a recovered empty wallet.

Locally issued receive/change indices extend the scan and prevent address reuse.
Results cover account 0 only and can miss activity beyond an unused gap. The
default limit is 1,000 addresses per branch, with a hard maximum of 2,000 and a
configurable gap of 20–100. Recovery UI must disclose those limits and provide
an explicit path for larger-gap recovery instead of claiming all funds were found.

The integrated reader requires a fresh checkpoint-verified configured backend,
bounded per-request timeouts, cancellation passed through the transport,
persistent issued indices, multiaddress balances/UTXOs, and recovery UI tests.
No account xpub needs to be sent to the backend; only the derived public address
is passed to the probe. These requests still reveal address association to the
configured operator. No seed or private key is accessed.

Verification: seven focused tests pass, including official BIP84 first-address
vectors on both branches. The native reference's abstract-hd-wallet.ts sets
gap_limit = 20. The original isolated verification is supplemented by the current integration
evidence in [release status](../../../../../RELEASE-STATUS.md).
