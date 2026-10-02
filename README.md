# RedWallet for iPhone

RedWallet is an iPhone wallet project based on [BlueWallet 8.0.1](https://github.com/BlueWallet/BlueWallet/releases/tag/8.0.1). The initial goal is an XBT-only wallet. BTC may be considered later as a separate, explicitly selected profile.

The iOS app name is now **RedWallet**. This repository is an independent community project and is not an official BlueWallet release. The original BlueWallet source is MIT licensed; its license and upstream attributions are retained.

The first XBT release is intentionally narrow: one Native SegWit/P2WPKH account, one keystore, and no BTC fallback. Lightning, multisig, silent payments, and Taproot are outside the first release. See [PROJECT_SCOPE.md](PROJECT_SCOPE.md) for the implementation plan and chain safety requirements.

## Project status

This is an early development fork. The XBT profile now covers BIP84 P2WPKH accounts and Unified Sighash signing, while shared upstream code still retains Bitcoin-mainnet assumptions in other address, derivation, fee, and service paths. The remaining verification gates below must pass before anyone should use it with funds.

The BIP84 XBT account and Unified Sighash P2WPKH signing path are implemented and checked against published vectors. That does not make sends ready for real funds: full transaction acceptance by Knots, trusted endpoint isolation, fee/history/broadcast handling, seed recovery/import, hardware-signing round trips, and physical-iPhone testing remain open. This is an experimental build; do not use it with real funds. The iOS bundle identifiers are provisional RedWallet identifiers and must be registered under the owner's Apple Developer team before TestFlight signing is enabled. Never commit signing certificates, API keys, or wallet secrets.

## Scope

- iPhone app only; changes should target the iOS app and shared wallet code it uses.
- Support XBT, with BTC retained as an optional chain if the chain profiles can stay clearly separated.
- Keep chain-specific address parsing, derivation, transaction construction, signing, fee estimates, history, and broadcast behavior explicit.
- Protect existing BlueWallet wallet data and BTC behavior while adding XBT.
- Require independent review and test vectors for address derivation, PSBT construction, and signed transaction serialization before release.

## Contributing

Use focused pull requests. Include reproducible tests and public test vectors for any chain or transaction change. Never include seed phrases, private keys, wallet backups, or real transaction secrets in issues, pull requests, screenshots, or test fixtures.

The project welcomes independent review, especially for chain separation and transaction signing. Until XBT support passes the security and compatibility checks above, builds are for development and testing only.

## License

RedWallet inherits the MIT license from BlueWallet. See [LICENSE](LICENSE) and retain upstream copyright notices when modifying or redistributing source files.
