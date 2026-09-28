# XBT price display

Open **Settings → XBT price** to choose a reference price.

- **Manual:** enter the price of one XBT and its quote currency, then save.
  For example, a price entered in USDC is labeled USDC; it is not relabeled USD.
  The app records when the manual price was saved.
- **NeoxEX:** refresh the latest recorded trade for the exchange's
  `BTCB2_USDC` market. The app labels the source **NeoxEX**, the quote
  currency **USDC**, and the actual trade time.
- **Clear:** remove the saved quote and its balance estimates.

Estimates appear beside visible wallet/total balances and respect hidden-balance
settings. Price configuration persists across app restarts. Exchange prices
older than 15 minutes are marked stale; a newly fetched response does not make
an old trade fresh. A failed refresh keeps the previous quote with its original
source and timestamp. Refresh is explicit, with no background polling.

This display quote never changes transaction outputs, fees, signing, or amount
entry. Spending amounts remain XBT or sats. The inherited Bitcoin fiat adapters,
cached BTC quotes, Bitcoin explorer links, and unverified notification services
remain disabled.

## NeoxEX integration reference

Verified against official public documentation and responses on 2026-09-28:

- [API documentation](https://neoxa.exchange/api-docs)
- [Market pairs](https://neoxa.exchange/api/exchange/pairs)
- [Latest trade](https://neoxa.exchange/api/exchange/trades/BTCB2_USDC?limit=1)

NeoxEX documents Bitcoin BLAKE2b as `BTCB2` in API requests and responses;
its website displays this asset as XBT. The verified pair has base
`BTCB2` and quote `USDC`. The adapter reads the trade's `price` and
`executed_at`, validates the exact pair and response shape, and uses a bounded
request timeout. The `ticker.computedAt` field is not a trade timestamp.
The `/api/prices` endpoint is intentionally not used because its response lacks
trade times and assumes USDC/USD parity.

No exchange account or API key is required. Requests contain only the public
market identifier, with no wallet addresses, balances, or recovery data.

## Validation

The 56 deterministic pricing unit tests pass locally: 39 adapter cases,
11 quote/storage/estimate cases, and 6 settings-screen cases. Exchange responses
are mocked in these tests; they verify market identity, trade age, failure
handling, request cancellation, persistence ordering, exact balance estimates,
and operation locking without contacting the exchange.

A Detox test covers manual save, app restart, restored quote, and clear.
Simulator execution is a separate pending gate; local unit success does not
establish native-device or TestFlight readiness.
