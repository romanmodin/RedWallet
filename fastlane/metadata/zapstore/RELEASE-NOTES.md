## Refresh and transaction-history hotfix

Fixes "Batch limit exceeded" when a Fulcrum server rejects a batch during balance, transaction-history, UTXO or transaction retrieval. RedWallet retries those requests individually on the same connection. Other errors and failed individual requests remain visible; they are not treated as empty history. Update, then refresh your existing wallet. No wallet re-import is required for this fix.

Includes the preceding Taproot creation/recovery/key-path signing, opt-in BIP86 watch-only signed-PSBT cold-signing flow, RBF fee bumps funded from sufficient change, and single-parent CPFP. Signing requires an XBT Unified (0x21) capable signer; ordinary Bitcoin signer firmware is incompatible. No script paths, annexes, multisig, RBF cancellation/added inputs or multiple unconfirmed CPFP ancestors. Return signed PSBT, not raw hex; after app restart create a fresh signing request.

Original Android application ID and release certificate retained. Automated tests and emulator installation/launch passed; no physical Android-phone or funded cold-device interoperability claim. No Google Play publication. No built-in/community Fulcrum server; configure your own.

Thanks to the testers who reported the refresh failure and all contributors. Source identity was verified against the reviewed public commit; this is not a binary-reproducibility claim.
