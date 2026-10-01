# RedWallet project scope

## Starting point

- Upstream: `BlueWallet/BlueWallet`
- Release baseline: `8.0.1`
- Baseline commit: `0a53056a636370073a58d6cdd6de5c0728e5926a`
- Target: iPhone (iOS)
- Initial chain goal: XBT-only; any future BTC support requires a separate explicit profile.

## Initial product scope

- XBT-only for the first release; no chain toggle or automatic BTC fallback.
- Network identity: exact profile `xbt-mainnet-blake2b`, plus the expected genesis and fork identity checks. XBT and BTC share genesis, key formats, and address encodings, so an address or genesis hash alone cannot identify the chain.
- One Native SegWit/P2WPKH account at `m/84'/0'/0'`, one keystore.
- P2WPKH signatures opt into the chain's Unified Sighash using `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`). The opt-in bit is `0x20`; the digest is the BIP341-shaped message defined by the Knots specification and tagged `UnifiedSighash`.
- Do not treat a proposed PSBT `chain=xbt` field as standard or as replay protection. Any app-specific PSBT metadata needs a documented BIP174 proprietary-key encoding and signer round-trip tests; chain selection and signing rules must remain independently enforced.
- Reject Taproot/P2TR in the first release. Also defer Lightning, multisig, silent payments, and implicit account aggregation.
- Keep private Electrum connectivity so the phone can use the user's own compatible XBT server. Do not silently fall back to a public BTC server.
- Display-only XBT pricing supports a labeled manual quote or explicit NeoxEX BTCB2/USDC refresh; send amounts remain XBT or sats. Inherited BTC price feeds, unverified explorers, remote push notifications, Watch, widgets, and native BTC price shortcuts are disabled for this first iPhone release.

## Chain facts required before implementation

Do not infer these values from Bitcoin defaults. Record the source and test vectors for each:

1. Chain identity: XBT and Bitcoin share the genesis hash, so verify the fork checkpoint. The first BLAKE2b block is height 961640, hash `0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb`; pin and test its 164-byte header against the selected Electrum server. The checkpoint was read from local Knots and matched byte-for-byte through local Fulcrum on 2026-09-27. Also verify any additional consensus/network identifiers and exact XBT profile string.
2. Address encodings: BIP84 P2WPKH `bc1` output encoding and receive/change derivation are verified against the published BIP84 vector and live Knots descriptor derivation. Base58 prefixes, other SegWit HRPs, and other output types remain to be verified.
3. Key derivation: BIP84 coin type `0` and accepted account path `m/84'/0'/0'` are verified against the published vector; accepted extended public/private key versions beyond this zpub/xpub path remain to be specified and tested.
4. Network services: Electrum protocol compatibility, independently verifiable server endpoints, broadcast API, fee estimates, explorer, and exchange-rate source.
5. Hardware signing: PSBT fields and signing behavior supported by each intended signer, including the Unified Sighash type and any separately specified proprietary chain metadata through QR export/import.
6. Coinbase spendability: detect coinbase UTXOs and distinguish consensus from wallet policy. The active consensus rule requires 6,480 confirmations for coinbases created at or after height 973440; earlier coinbases retain the 100-confirmation consensus rule. Knots 29.4.2 wallet/mempool policy applies 6,480 confirmations to every coinbase while the long-maturity deployment is active, and this RedWallet implementation follows that conservative policy. Do not treat the deployment window as a permanent constant; verify its status from chain parameters and add boundary tests before changing this behavior.

## Development plan

1. **Fork and app identity:** pin BlueWallet 8.0.1 and keep upstream attribution. The iPhone display name is RedWallet. This branch now uses the provisional distinct bundle ID `com.romanmodin.redwallet` (plus matching extension IDs and app group); the owner must register/confirm these identifiers under their Apple Developer team before a signed device build.
2. **Chain profile:** verify the active XBT node, profile, fork checkpoints, and published test vectors; encode the values in one explicit profile with fail-closed checks.
3. **Wallet foundation:** add the single P2WPKH account at `m/84'/0'/0'`. First receive, second receive, and first change address derivation now match the published BIP84 vector and live Knots descriptor results; deterministic seed-recovery UI coverage is added and awaits simulator/device verification. Extended-key imports are deliberately rejected for this release; receive history still needs live validation.
4. **Transaction and signing:** the specified P2WPKH Unified Sighash digest and signature type (`SIGHASH_ALL | SIGHASH_UNIFIED`, `0x21`) are implemented in the custom PSBT signing/finalization path. Unit tests cover the upstream sighash vectors, PSBT round trips, and XBT transaction behavior. Reject unsupported script types before signing. A two-input software transaction passed activated Knots regtest mempool and block validation on 2026-09-28; output and sighash-bit tampering were rejected. See [XBT_VALIDATION.md](XBT_VALIDATION.md) for exact evidence and limits. Hardware/PSBT exchange is deferred; do not treat app-specific PSBT metadata as standard or as a substitute for sighash enforcement.
5. **Network services:** require a user-configured, compatible XBT Electrum server. RedWallet checks the pinned height-961640 header on save and connection, ships no Bitcoin Electrum peers, and never falls back to BTC. Fee estimates, history, and raw UTXO reads passed a live application-adapter check against a Knots-verified public output. Phone presentation, parent-transaction caching, spend selection, and broadcast still require end-to-end validation. A separate display-only price setting supports manual quotes and the verified NeoxEX BTCB2/USDC market, with source/time labels and stale-trade indication (see [XBT_PRICE.md](XBT_PRICE.md)). Inherited BTC fiat adapters remain disabled. Explorer links and remote push notifications remain unavailable until compatible XBT services are verified.
6. **iPhone QA:** test the supported software-wallet receive/send flow, onchain QR scanning, wrong-chain rejection, offline recovery, and persistence on physical iPhones and the Fulcrum-backed XBT test environment. Verify replay separation independently. Hardware signing and proprietary metadata round trips are deferred outside the first release.
7. **Private beta:** distribute builds to our own iPhones through TestFlight after signing and App Store Connect setup; use TestFlight feedback to find device and workflow issues.
8. **Maintainer review and optional outside review:** review focused changes for chain separation, address validation, PSBT parsing, sighash construction, and broadcast before any public wallet release. The project does not depend on community participation; one knowledgeable outside reviewer is welcome if available.
9. **Store release:** submit for App Review only after the security and compatibility gates pass, and through an organization-enrolled developer account as Apple's current wallet guideline requires.

## Current implementation note

The upstream code directly uses `bitcoinjs-lib` Bitcoin mainnet defaults in multiple wallet classes and transaction flows. A ticker or network selector alone is unsafe: address, key, fee, history, signer, and broadcast paths must share one selected chain profile. XBT and BTC remain separate wallet identities. The XBT BIP84 profile is connected to new-wallet creation and software P2WPKH send signing. It verifies the selected Electrum server's fork checkpoint and follows Knots 29.4.2 wallet/mempool policy by filtering coinbase UTXOs until 6,480 confirmations while the long-maturity deployment is active. First receive, second receive, and first change addresses match the published BIP84 vector and live Knots descriptor results. The custom PSBT signing/finalization path preserves `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`); unit tests cover the upstream Unified Sighash vectors, PSBT round trips, and XBT transaction behavior. The live Fulcrum test confirms the pinned height-961640 header. A real two-input software-wallet transaction passed activated Knots regtest acceptance and block confirmation; two signature-tampering controls were rejected (see [validation record](XBT_VALIDATION.md)). The restored CI suite adds deterministic BIP84 recovery and preserves applicable settings, encryption, deletion, and onchain scan coverage; runtime results remain separate gates. Live Fulcrum history, balance, raw UTXO, and fee reads passed through the application adapter. The recorded signatures also fail independent Bitcoin BIP143 digest verification. Phone/backend send flow and broadcast, physical iPhone recovery, independent Bitcoin-node rejection, and Apple signing/TestFlight remain open. Extended-key imports, multisig, hardware signing, and alternate accounts are outside this first-release profile.

## Consensus references

- [Canonical BLAKE2b-chain developer guidance](https://bitcoin-blake2b.org/developers)
- [Knots Unified Sighash specification](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/doc/unified-sighash.md)
- [Knots consensus implementation PR #357](https://github.com/bitcoinknots/bitcoin/pull/357)
- [Canonical developer guidance on long coinbase maturity](https://bitcoin-blake2b.org/developers)

## Test backend

Integration testing will use a privately configured XBT-compatible Fulcrum endpoint. Keep its hostname, credentials, and connection details in local configuration; never commit them. Fulcrum's advertised features and the shared Bitcoin genesis hash are not sufficient by themselves to distinguish XBT from BTC.

## App Store distribution gate

Apple's current App Review Guidelines say cryptocurrency wallet apps must be offered by a developer enrolled as an organization. The Apple Developer Program is currently USD $99/year. Confirm an eligible organization account before planning App Store or TestFlight distribution; a free Apple Account can still be used to install a development build on a personal iPhone through Xcode. RedWallet also needs its own registered bundle ID, distinct product icon and listing, privacy details, a reviewable live backend, and App Review approval. See Apple's [wallet guideline](https://developer.apple.com/app-store/review/guidelines/), [enrollment](https://developer.apple.com/help/account/membership/program-enrollment), and [upload workflow](https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds).

## Native review follow-up

See [XBT_PR_REVIEW.md](XBT_PR_REVIEW.md) for the 2026-10-01 corrections, reviewer credit, replay-protection limits, and validation.
