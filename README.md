# RedWallet for iPhone

RedWallet is an iPhone wallet project based on [BlueWallet 8.0.1](https://github.com/BlueWallet/BlueWallet/releases/tag/8.0.1). The initial goal is an XBT-only wallet. BTC may be considered later as a separate, explicitly selected profile.

The iOS app name is now **RedWallet**. This repository is an independent community project and is not an official BlueWallet release. The original BlueWallet source is MIT licensed; its license and upstream attributions are retained.

The first XBT release is intentionally narrow: one Native SegWit/P2WPKH account, one keystore, and no BTC fallback. Lightning, multisig, silent payments, and Taproot are outside the first release. See [PROJECT_SCOPE.md](PROJECT_SCOPE.md) for the implementation plan and chain safety requirements.

## Project status

This is an early development fork. The upstream wallet currently assumes Bitcoin mainnet in several address, signing, derivation, fee, and service paths. XBT support must be implemented and tested as a separate chain profile before anyone should use it with funds.

We need authoritative XBT network details before wiring transactions: address and extended-key versions, derivation coin type, genesis/network identity, trusted Electrum endpoints, fee and broadcast services, and explorer/rate sources. Until those are confirmed and reviewed, RedWallet must not imply that an XBT transaction is ready to sign or broadcast. Do not add signing or App Store Connect secrets to this repository while the inherited BlueWallet app identifiers and release workflows remain under review.

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
