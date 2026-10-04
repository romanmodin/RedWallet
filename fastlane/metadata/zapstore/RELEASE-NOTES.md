## Refresh and transaction-history hotfix

Fixes "Internal error: unable to decode address from output script" while refreshing transaction history. Raw outputs without addresses retain their value, script and index, and P2WSH destinations are decoded correctly; coinbase history no longer queries a nonexistent parent. The earlier same-server batch-limit recovery is retained. Other errors and failed individual requests remain visible; they are not treated as empty history. Update, then refresh your existing wallet. No wallet re-import is required for this fix.

Includes the preceding Taproot creation/recovery/key-path signing, opt-in BIP86 watch-only signed-PSBT cold-signing flow, RBF fee bumps funded from sufficient change, and single-parent CPFP. Signing requires an XBT Unified (0x21) capable signer; ordinary Bitcoin signer firmware is incompatible. No script paths, annexes, multisig, RBF cancellation/added inputs or multiple unconfirmed CPFP ancestors. Return signed PSBT, not raw hex; after app restart create a fresh signing request.

Original Android application ID and release certificate retained. Automated tests and emulator installation/launch passed; no physical Android-phone or funded cold-device interoperability claim. No Google Play publication. No built-in/community Fulcrum server; configure your own.

Thanks to the testers who reported the refresh failure and all contributors. Source identity was verified against the reviewed public commit; this is not a binary-reproducibility claim.
