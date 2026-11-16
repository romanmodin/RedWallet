# Kilombino XBT → SHA256 Lightning bridge — staged integration

Status: **quote-only, no payment submission**. This work must not be described as live cross-chain payment support.

The iPhone embedded XBT Lightning screen now has a separate, explicitly selected **Preview SHA256 payment via Kilombino** action. An `lnbc` BOLT11 invoice cannot be reliably classified by prefix alone: both fork networks use the same invoice prefix. Normal XBT invoice payment remains unchanged. Do not silently redirect an XBT invoice through a swap service.

The quote module uses the public HTTPS service at `https://bridge.kilombino.com`:

1. Decode and validate the user-provided SHA256 mainnet BOLT11 invoice locally, including payment hash, amount, and expiry.
2. `GET /api/info`, verify the bridge and `dirs.toSHA256` are open, and display the live direction-specific rate/spread.
3. `GET /api/pow`, compute the required SHA256 proof over `<challenge>:<original invoice payment hash>:<lowercase base36 nonce>`.
4. `POST /api/quote` with `{ invoice, pow: { challenge, nonce } }`.
5. Validate the returned hold invoice, payment amount, expiry, and settlement token. **Do not pay the hold invoice yet.**

## Payment enablement blockers

- Verify the quote response schema against real *non-spending* test invoices; in particular, the time unit of `expires_at`, whether `pay_sat` refers to the hold invoice amount, and whether the two invoices share a payment hash.
- Design and audit the native LND payment submission flow, keeping the existing biometric/foreground authorization and persistent LND payment history as the source of truth. Do not send twice after an ambiguous outcome.
- Implement secure persistent swap-state storage for the bridge token and original invoice, surviving iOS background suspension, termination and reboot. Never persist the bearer token in plain AsyncStorage or include it in logs.
- Verify remote settlement with `GET /api/swap/<original payment hash>?t=<token>` and cryptographically verify the returned preimage against the original SHA256 payment hash before displaying merchant-payment success. Distinguish XBT hold-invoice settlement from merchant invoice settlement.
- Define provider failure, expiry, and refund semantics; add tests for both chains, interrupted connections, and quote expiration. A quote expiring does not prove a payment failed.
- Obtain explicit approval before any real-funds tests. Test with small amounts only after a full review.
- Add more independent bridge providers only after their protocols and risk models have been verified.

No additional Umbrel container or proxy is required for the current quote-only client. The service is externally hosted; the iOS app contacts it directly over HTTPS. Do not route wallet credentials or LND macaroons through Umbrel or the bridge.

Developer discussion: https://discord.com/channels/1376602546545754244/1376602547418300549/1567944272236380312
