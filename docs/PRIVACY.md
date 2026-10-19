# RedWallet privacy policy

Effective October 19, 2026. This policy describes the native RedWallet iOS application distributed by ROMAN M WINTER MEDICAL INC. RedWallet is an independent XBT wallet derived from BlueWallet; BlueWallet's privacy policy does not govern this fork. This wallet does not provide medical services.

## Information stored on your device

RedWallet stores wallet keys and recovery information, wallet names, public addresses, transaction history and notes, and your settings locally so that you can manage your wallets. Wallet signing takes place locally for hot wallets. Recovery words, private keys and wallet-encryption passwords are not sent to the developer or to an Electrum server by the wallet's normal network operations. Password protection is optional; use the encryption and device-lock features to protect local data.

There is no RedWallet online account or central wallet-recovery service. The developer cannot restore a lost recovery phrase or reverse a transaction.

## Network requests

To obtain balances and history and broadcast transactions, the app connects to the Electrum/Fulcrum server you configure, including any backup servers you add. It sends address-derived script hashes, transaction identifiers, public transaction data and protocol requests. The server can associate those requests with your network address, infer related wallet activity, and apply its own logging and retention policy. A hash of an address script is not an anonymity guarantee. Choose a server operator you trust, preferably your own server, and use authenticated TLS.

The chain-status indicator requests public block heights and headers from mempool.guide and, if configured, your HTTPS Knots reference. It does not send wallet addresses, wallet balances or recovery information to these references. Requests expose normal network metadata, such as your IP address and request time, to the service.

If you enable NeoxEX prices, the app requests the public XBT/USDC trade quote from neoxa.exchange. Saved NeoxEX quotes refresh when the app becomes active. No wallet balance, address, recovery phrase or transaction-signing information is included in the quote request. The exchange sees normal network metadata. A manually entered price can be used instead.

The developer does not receive these requests through a central RedWallet analytics service. Independent services you choose or enable have their own privacy practices. Disconnecting the wallet network stops server requests; clearing the NeoxEX setting or selecting a manual price stops its automatic quote refresh. Remove a configured Knots reference to stop requests to it.

## Public transactions and sharing

Broadcast transactions become public blockchain data, including input and output addresses, amounts and transaction identifiers. Network participants may retain that data indefinitely; deleting a local wallet cannot remove blockchain records.

QR scanning is used to read payment and wallet information on the device. Camera access can be revoked in iOS Settings. Exporting, copying or sharing information is an action you choose; the destination app, clipboard, saved files, backups or recipient may retain a copy. Never share your recovery phrase or private keys with support.

## Analytics, advertising and Apple services

Remote analytics, remote crash reporting and advertising are disabled in RedWallet. The app does not sell wallet data or use it for targeted advertising. An identifier displayed in About is local diagnostic information and is not automatically sent to a developer analytics service.

Apple may process App Store, TestFlight, purchase/download and diagnostic information under Apple's own settings and privacy terms. GitHub and other websites opened through links handle browsing and support information under their own policies.

## Retention, deletion and support

Local wallet information remains until you delete it through the wallet's controls or remove the app's data. Wallet deletion removes the app's wallet record and associated active cache; it does not erase copies you exported, device/system backups, data retained by server operators, or public blockchain records. Save any recovery information you need before deleting a wallet. The app has no online account to close.

For questions or deletion requests concerning information you voluntarily supplied to the developer, contact RedWallet support at https://github.com/romanmodin/RedWallet/issues. GitHub issues are public: provide only a non-sensitive description and ask for a private contact method before sharing personal details. Do not post seeds, private keys, passwords, identifying wallet addresses or balances. Support content is retained in the support system until removed through that system's controls or handled in response to a request, subject to applicable obligations.

Changes to these practices will be reflected in this policy and the app's store disclosures.
