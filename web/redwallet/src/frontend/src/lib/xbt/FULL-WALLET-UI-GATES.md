# Full-wallet UI integration gates

Non-secret record of the gates that must be satisfied before any signing or
seed UI is wired into RedWallet. It contains no bridge URL, bridge secret,
operator principal, draft access-token URL, seed, or private key.

## Current integration status

As of0.37, local vault/recovery/discovery, review/signing and constrained
broadcast are connected and published. The earlier v7 watch-only posture is
historical. See the current [release status](../../../../../RELEASE-STATUS.md)
for completed evidence and remaining profile limits. Private keys/passwords
remain local; no private-key endpoint exists in the adapter or bridge.

## Gates before any signing or seed UI is connected

These extend the release gates in `KEY-VAULT-AND-SPEND-PLAN.md`; they do not
replace them.

1. **Live read path verified.** The operator has reviewed, exported, and
   deployed the bridge privately, and the actual canister has been verified to
   return real `address.utxos` and `transaction.raw` results. Until then, no
   signing UI may depend on those reads.
2. **Fresh checkpoint-verified status.** Integration requires a fresh
   checkpoint-verified bridge status and current UTXOs before signing; the
   planner trusts the caller's chain-height observation and provides no SPV
   proof validation.
3. **Backup confirmation and recovery UI.** Backup confirmation, recovery UI,
   and storage-loss messaging exist and are exercised, including the discovery
   limits (account 0 only, default gap 20, 1,000 addresses per branch, hard
   maximum 2,000) with an explicit path for larger-gap recovery.
4. **HD discovery wired and tested.** `discoverAccount` is connected through a
   bounded, cancellable transport with persistent issued indices and
   multiaddress balances/UTXOs, and recovery UI tests cover failed, malformed,
   and incomplete history reads.
5. **Review-state lifecycle.** The review digest that binds every input,
   recipient, amount, change index, and fee has a defined lifecycle: changed
   reviews are rejected, and locked or mismatched wallets cannot sign.
6. **Constrained broadcast.** Broadcast is constrained with exact txid checking
   and deduplication, and remains off until the acceptance and replay tests
   below pass.
7. **Acceptance and replay tests.** Fresh activated-XBT acceptance and
   BTC replay-negative tests pass, and actual browser and iPhone validation is
   completed.
8. **Production CSP and dependency review.** A production CSP and dependency
   review is complete, acknowledging that password encryption does not protect
   an unlocked wallet from malicious page code or a compromised origin, and
   that the public xpub is stored unencrypted and is sensitive wallet-activity
   metadata.
9. **Coinbase maturity.** Published0.42 integrates the XBT mainnet
   consensus boundaries and stricter6,480-block relay policy, with authenticated
   raw-parent height checks and boundary/signing/selection regressions. See
   V041-BACKGROUND-AND-MATURITY.md at the app root for evidence and publication
   status. No new funded live-node coinbase acceptance is claimed.

## Explicitly out of scope until the gates pass

Unconfirmed inputs, Taproot, legacy outputs, RBF UI, HD gap discovery beyond
the documented limits, and multi-account recovery are not implemented. The
browser harness uses public, unfunded test vectors only and must never be used
as wallet keys. Existing recorded Knots acceptance remains fixture parity, not
a new transaction accepted by a live node in this continuation.

## References

- `KEY-VAULT-AND-SPEND-PLAN.md` — implemented foundation and release gates.
- `DISCOVERY.md` — discovery limits and integration requirements.
- `SPENDING-DATA-VERIFICATION.md` — read-only spending-data verification.
