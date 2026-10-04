RedWallet Android beta: Taproot, cold signing and fee bumping

New in this update:
- Create/recover BIP86 Taproot wallets, receive/change addresses and Unified Schnorr key-path spending.
- Opt-in BIP86 watch-only accounts prepare PSBT requests and verify returned signed PSBTs against the exact reviewed transaction, authenticated inputs and Schnorr signatures.
- RBF raises eligible outgoing transaction fees while preserving inputs and recipient amounts; the extra fee comes from change.
- CPFP calculates a child's fee for the unconfirmed parent plus child together.
- Hot-wallet fee review includes the actual fee, enabled biometrics and high-fee confirmation.

Install over the existing official RedWallet APK: the release signing certificate is unchanged. Android 7+, ARM64, ARM32 and x86_64. Authenticated Fulcrum TLS, encrypted/decoy storage, authenticated secret export and manual/NeoxEX USDC estimates remain supported.

Limitations: external Taproot signing requires an XBT Unified-capable signer (SIGHASH 0x21); ordinary Bitcoin signer firmware is incompatible with that signature scheme. Return a signed PSBT, not raw signed transaction hex. Requests belong to the current app session; after restart or replacing a request, create and sign a fresh request. No Taproot script paths, annexes or multisig. RBF requires replaceability and enough change; cancellation and adding inputs are unsupported. CPFP supports one unconfirmed parent with confirmed inputs and a spendable owned output. Descendants and node policy may require higher fees; acceptance/confirmation is not guaranteed. Independent full header-chain/Merkle verification remains unimplemented. No community/default Fulcrum endpoint is bundled; configure your own server.

Validation: 81 suites / 750 tests passed (one inherited skip), lint, and both native iOS/Android checks (7 TLS + 15 supported wallet checks, 5 inherited unsupported skips). Independent isolated Knots tests verified fee acceptance and public-vector software-signer PSBT interoperability. Android release package installation/launch passed on the emulator. Physical cold-device and funded physical-phone interoperability remain unverified. The maintainer does not own an Android phone and has not personally tested this build on Android hardware.

Begin with an empty disposable wallet and keep an offline recovery backup. Existing store screenshots show an earlier empty-wallet emulator beta, not new hardware tests.

Reviewed public source: 32c54888ee383cc1fe418b7c5968376dfeadd71d; Android build source: 55da26022f6d9d211d286cc07486cce0cec19a82; build run: 37202360816. Exact production source maps across 945 paths, SHA-256 ff91f542e77c912d69b48d40c834eabc42c838e4924232e33f52d6bb00b59157. Package checksum/signature receipts are attached; binary reproducibility is not claimed.

Thanks to BlueWallet, contributors, reviewers and testers.

Known issue reported after publication: some servers reject large JSON-RPC batches with "Batch limit exceeded," interrupting refresh/history loading. A same-server individual-request recovery patch is being validated and is not included in this build. An empty transaction list after that error does not establish an empty wallet.
