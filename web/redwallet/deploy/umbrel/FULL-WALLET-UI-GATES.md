# Remaining full-wallet integration

Standing user authorization covers implementation and deployment. Live remains
watch-only until these concrete integration checks pass. This document is the
implementation checklist, not a claim that the features below exist.

## Recovery and vault UI

- Create a 24-word phrase with the reviewed cryptographic entropy function.
  Display it only inside the user's app; never put it in logs, URLs, telemetry,
  backend calls, Caffeine prompts, screenshots of a real wallet, or plaintext
  persistence. Require backup verification before making deposits available.
- Recover English BIP39 phrases with optional exact NFKD-normalized passphrase.
  Explain that a different passphrase creates a different wallet and cannot be
  checked against a server. Match the native BIP84 account-0 profile.
- Encrypt locally with the reviewed vault. Confirm the new password, handle
  storage denial/quota errors, refuse overwrites, and show recovery/storage-loss
  guidance. An encrypted vault persisted without its display-list registration
  must remain discoverable; do not silently orphan it after a second write fails.
- Unencrypted envelope xpub/address fields are not authenticated until unlock.
  Do not offer a receive address from tamperable locked metadata as verified
  ownership. Unlock and authenticate before displaying/copying a vault receive
  address. Keep watch-only and encrypted wallets visibly distinct.
- Mount lock lifecycle once. Backgrounding, pagehide, timeout, storage change,
  wallet switch and manual lock invalidate reviews and pending secret operations.
  Clear phrase/password UI state on cancellation/backgrounding. JavaScript cannot
  guarantee erasing every garbage-collected copy; make no such claim.
- Review production CSP, external scripts/resources and dependency integrity
  before enabling key-handling UI. Never relax protections to make a test pass.

## Discovery and public data

- Wire bounded account discovery through the configured, checkpoint-verified
  canister. Any spent/unconfirmed history counts as usage; errors do not mean
  unused. Account-0 and gap/cap limitations must be clear during recovery.
- Respect existing global/per-caller/cycle caps. Recovery requires cancellable
  progress and resumable throttling, not removal of the cost limits or retry
  storms. Persist issued receive/change indices before exposing an address.
- Aggregate balances/history across discovered branches with integer satoshis.
  Do not fabricate transaction amounts/times absent from available chain data.
- Read UTXOs and raw parents through the bounded APIs. The current planner
  rejects all coinbase and unconfirmed inputs, and supports P2WPKH only. Keep
  these limits explicit until native XBT-specific maturity handling is added.

## Review and broadcast

- Before signing, obtain fresh checkpoint status and current UTXOs; check every
  parent txid, outpoint, amount and owned script using the reviewed planner.
- Review binds destination, integer amount, fee/rate, change, all inputs and
  network identity. Edits, expiry, lock or wallet changes discard the review.
- Use only native XBT Unified 0x21 signing. Never substitute ordinary BTC signing.
  Fresh isolated web-signer acceptance and Bitcoin rejection are now evidenced
  in test/regtest; repeat if signing semantics change.
- Add a constrained raw-transaction broadcast path with strict hex/size bounds,
  validation, exact returned txid checking, rate limits and duplicate-submit
  handling. A timeout is an unknown outcome, not proof the transaction failed;
  reconcile by txid before retrying. Never rebuild/re-sign automatically to retry.
- Test the final connected browser flow using public fixture data and no real
  keys. Any actual fund-transfer confirmation is performed by the user.

## Release evidence

Export and review the completed Caffeine source; test actual canister methods
through HTTPS after deploying the bridge. Verify old balance/history/receive,
donation and operator authorization still work. Save exact source, tests,
deployment/canister IDs and limitations to Git and Roman Knowledge. Only then
describe the enabled capabilities; never call the existing watch-only build a
complete spending wallet.
