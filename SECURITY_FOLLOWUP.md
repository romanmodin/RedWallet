# Security review follow-up

This change responds to the independent source review of PR #1. It is a source update, not a claim that the installed TestFlight or Android binary already includes it, and not evidence of a breach.

## Changes

- BIP84 Native SegWit public accounts can be imported as XBT watch-only accounts. Spending requires explicitly enabling an XBT-compatible external signer. Legacy BTC hardware settings do not enable it. The phone stores public keys only; the cold wallet retains the spending keys.
- Every exported signing input declares `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`). Returned PSBTs must match the current request created in the app. Both partial and finalized signatures are cryptographically verified against the reviewed transaction and prevout amounts before broadcast. BTC signatures, relabeled BTC signatures, changed outputs, and pasted raw transactions without a verified signing request are rejected. Existing hardware QR/file transport remains available. A device must support Native SegWit PSBTs and return a signed PSBT; claiming Unified support alone does not establish transport compatibility. Restarting the app requires creating a fresh signing request.
- XBT history refreshes fetch and hash raw transactions locally. Coinbase classification, prevout amounts and scripts come from those bytes rather than verbose server JSON. Missing or mismatched raw parents cannot be selected or signed. Change must belong to the wallet. Existing cached history is refreshed when raw bytes are absent.
- Server fee suggestions are capped at 100 sats/vB. Final fees exceeding 100 sats/vB, 100,000 sats, or 5% of the payment require an additional confirmation in both hot-wallet and external-signing sends. User-entered fees are not silently rewritten.
- Transaction preparation always asks the user to confirm the recipient expects XBT, including camera, shared-image, clipboard and manual-address paths. The warning occurs before preparing the signing request.
- Seed and private-key export requires device authentication or the active storage password. A decoy bucket's password cannot authorize an active wallet's export. Copied secrets expire after 30 seconds or when the app backgrounds; later clipboard contents are preserved. Exported public watch-only keys do not require spending-secret authentication.
- New password-encrypted writes use a versioned scrypt/AES-256-GCM envelope (`RWV2:`; N=32768, r=8, p=3; random 16-byte salt and 12-byte nonce). Old OpenSSL/MD5/AES-CBC buckets remain readable. The active bucket upgrades when saved; other buckets are preserved. Older app versions cannot read v2: do not downgrade after upgrading, and retain an offline recovery backup.
- Transaction and Electrum caches use random 64-byte keys and random filenames. Their legacy-path mapping is stored in the platform Keychain, so new cache filenames and key service names do not expose a fast password fingerprint. Migration copies the old cache and verifies that the new copy opens before removing the original. Migration failure preserves the old file. The wallet-data Keychain store and its already-random fallback Realm key remain in use.
- PR unit jobs no longer reference mnemonic secrets; workflow permissions default to read-only contents. External verification no longer sends signed transactions to coinb.in.

## Findings corrected or left explicit

Native wallet data already uses the platform secure key store; the separate transaction cache's former deterministic key did not encrypt seeds. Private-key export already checked biometrics when app biometrics were enabled; this update makes authentication unconditional at the secret boundary and adds it to seed export.

A historical checkpoint is a chain-selection check, not server authentication or SPV. Raw transaction hashing does not prove that an output is unspent or confirmed. Confirmations and timestamps remain supplied by the configured Fulcrum server. Full header-chain and merkle-proof validation requires a separate implementation; use a trusted server, preferably TLS. The app does not claim independent confirmation verification.

The 6480-confirmation coinbase filter remains conservative for the reviewed Knots policy. Consensus maturity and the temporary long-maturity window are distinct from mempool policy; this change does not relax the filter or implement a proposed future consensus rule.

An XBT `0x21` spend cannot be replayed as an ordinary BTC spend. An ordinary BTC spend of a shared pre-fork output can still affect XBT. The existing recovery warning remains. No automatic sweep or transaction is performed by this change.

Physical XBT cold-wallet QR signing, native cache migration on iOS/Android, and restored-wallet full transaction history must be checked on a tester build before shipping. Synthetic tests cannot establish a particular hardware device's compatibility. The earlier report of a balance with missing history still needs a missing transaction ID and the configured server/build to reproduce; it is not claimed fixed here.

## Validation

Regression coverage includes real Knots acceptance vectors, partial/finalized Unified external signatures, rejected BTC/relabelled signatures and altered requests, raw-parent mismatch and amount/change ownership checks, vault interoperability against Node's scrypt/AES-GCM, tampering and legacy/decoy migration, cache migration failures, export authentication, clipboard expiry/background races, and high-fee cancellation before network access.

Final check results and any remaining limitations are recorded in the pull request.
