# XBT → SHA256 Lightning bridge (in development)

Work is isolated from the pending combined Lightning candidate. No real funds may be spent during development.

The processor picker must precede any quote or disclosure of the invoice. Initially Kilombino is the only implemented provider; no placeholders are advertised as working processors. Normal XBT invoices continue through the existing native flow. BOLT12 remains separate.

Protocol evidence: Kilombino/kilobridge ab6080a4826a315217790c78908404fd4121c8d5, web/server.js and web/bolt11.js; Kilombino/lightning-fork-bridge b67e9d004cb43ef376b5b07e6dbc397effe7459e docs/payer-api.md; Kilombino/kilowallet e368766168dff16ea2302cd5ced8860dc019b3ef Bridge.kt and Lightning.kt. HTTPS public endpoint returned 403 in the development environment; linked Discord messages could not be fetched. Live service compatibility is not yet verified.

Both chains use lnbc. Signed feature 512 or 513 identifies XBT; the hold invoice must carry that feature, the original SHA256 payment hash, the pinned bridge destination, a bounded CLTV and the exact quoted millisatoshi amount. pay_sat is rounded UP by the public API, not necessarily an integer-satoshi hold invoice. rate is outgoing SHA256 per incoming XBT; spread is added before rounding.

The public status endpoint uses the ORIGINAL payment hash (also the hold hash), hex; token reveals a hex preimage. settled on the website alone is not success. A local XBT LND terminal payment with a matching SHA256 preimage must establish settlement. Failed/expired bridge status cannot release an uncertain local payment. Quote expiry is not an HTLC refund deadline.

Implementation remaining: durable secure payment journal, native millisatoshi payment/status adapter, processor picker and review/history integration, automated tests, security/Gitar review and native qualification. No build or TestFlight readiness is claimed.
