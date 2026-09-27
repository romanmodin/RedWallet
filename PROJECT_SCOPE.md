# RedWallet project scope

## Starting point

- Upstream: `BlueWallet/BlueWallet`
- Release baseline: `8.0.1`
- Baseline commit: `0a53056a636370073a58d6cdd6de5c0728e5926a`
- Target: iPhone (iOS)
- Initial chain goal: XBT, with BTC as an optional supported chain

## Initial product scope

- XBT-only for the first release; no chain toggle or automatic BTC fallback.
- Network identity: exact profile `xbt-mainnet-blake2b`, plus the expected genesis and fork identity checks. XBT and BTC share genesis, key formats, and address encodings, so an address or genesis hash alone cannot identify the chain.
- One Native SegWit/P2WPKH account at `m/84'/0'/0'`, one keystore.
- P2WPKH signatures opt into the chain's Unified Sighash using `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`). The opt-in bit is `0x20`; the digest is the BIP341-shaped message defined by the Knots specification and tagged `UnifiedSighash`.
- Do not treat a proposed PSBT `chain=xbt` field as standard or as replay protection. Any app-specific PSBT metadata needs a documented BIP174 proprietary-key encoding and signer round-trip tests; chain selection and signing rules must remain independently enforced.
- Reject Taproot/P2TR in the first release. Also defer Lightning, multisig, silent payments, and implicit account aggregation.
- Keep private Electrum connectivity so the phone can use the user's own compatible XBT server. Do not silently fall back to a public BTC server.

## Chain facts required before implementation

Do not infer these values from Bitcoin defaults. Record the source and test vectors for each:

1. Chain identity: expected genesis and fork checkpoint hashes, consensus/network identifiers, and exact XBT profile string.
2. Address encodings: Base58 prefixes, SegWit HRP, and supported output types.
3. Key derivation: BIP44 coin type and accepted extended public/private key versions.
4. Network services: Electrum protocol compatibility, independently verifiable server endpoints, broadcast API, fee estimates, explorer, and exchange-rate source.
5. Hardware signing: PSBT fields and signing behavior supported by each intended signer, including the Unified Sighash type and any separately specified proprietary chain metadata through QR export/import.

## Development plan

1. **Fork and app identity:** pin BlueWallet 8.0.1, keep upstream attribution, set the iPhone app display name to RedWallet, and establish a separate app/bundle identity before installing alongside BlueWallet.
2. **Chain profile:** verify the active XBT node, profile, fork checkpoints, and published test vectors; encode the values in one explicit profile with fail-closed checks.
3. **Wallet foundation:** add the single P2WPKH account at `m/84'/0'/0'`, then verify seed recovery, xpub import, address derivation, change addresses, and receive history.
4. **Transaction and signing:** implement the specified P2WPKH Unified Sighash digest and signature type (`SIGHASH_ALL | SIGHASH_UNIFIED`, `0x21`), verify against upstream vectors, and reject unsupported script types before signing. Specify any proprietary PSBT chain metadata separately; do not substitute it for the sighash.
5. **Network services:** use a user-configurable, compatible XBT Electrum server; replace BTC-only fee, history, explorer, and broadcast assumptions; validate chain identity and never fall back to BTC.
6. **iPhone and hardware QA:** test receive/send, QR and hardware signing, Unified Sighash preservation and approved metadata round-trip, replay separation, wrong-chain rejection, and offline recovery on physical devices and your Fulcrum-backed XBT test environment.
7. **Private beta:** distribute builds to our own iPhones through TestFlight after signing and App Store Connect setup; use TestFlight feedback to find device and workflow issues.
8. **Independent review and community sharing:** invite XBT Discord contributors to review focused changes for chain separation, address validation, PSBT parsing, sighash construction, and broadcast before any public wallet release.
9. **Store release:** submit for App Review only after the security and compatibility gates pass, and through an organization-enrolled developer account as Apple's current wallet guideline requires.

## Current implementation note

The upstream code directly uses `bitcoinjs-lib` Bitcoin mainnet defaults in multiple wallet classes and transaction flows. A ticker or network selector alone would be unsafe: every address, key, fee, history, signer, and broadcast path must use the same selected chain profile. XBT and BTC should remain separate wallet identities even if dual-chain support is added later.

## Consensus references

- [Canonical BLAKE2b-chain developer guidance](https://bitcoin-blake2b.org/developers)
- [Knots Unified Sighash specification](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/doc/unified-sighash.md)
- [Knots consensus implementation PR #357](https://github.com/bitcoinknots/bitcoin/pull/357)

## Test backend

Integration testing will use a privately configured XBT-compatible Fulcrum endpoint. Keep its hostname, credentials, and connection details in local configuration; never commit them. Fulcrum's advertised features and the shared Bitcoin genesis hash are not sufficient by themselves to distinguish XBT from BTC.

## App Store distribution gate

Apple's current App Review Guidelines say cryptocurrency wallet apps must be offered by a developer enrolled as an organization. The Apple Developer Program is currently USD $99/year. Confirm an eligible organization account before planning App Store or TestFlight distribution; a free Apple Account can still be used to install a development build on a personal iPhone through Xcode. RedWallet also needs its own registered bundle ID, distinct product icon and listing, privacy details, a reviewable live backend, and App Review approval. See Apple's [wallet guideline](https://developer.apple.com/app-store/review/guidelines/), [enrollment](https://developer.apple.com/help/account/membership/program-enrollment), and [upload workflow](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds).
