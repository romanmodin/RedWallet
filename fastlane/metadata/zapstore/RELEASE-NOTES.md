## Live XBT Lightning and invoice QR codes

Adds the embedded live XBT Lightning engine to the existing RedWallet Android app. Create invoices as QR cards, tap to switch between QR and full text, and copy or share the full invoice. The Lightning panel scrolls across the QR card. Node activity, channel counts, balances, payment history, channel management and encrypted recovery exports are available from XBT Lightning settings.

The original package and signing certificate are retained, with a newer Android version code. Installation over the previous signed candidate preserved an existing empty wallet and its receiving address on an Android 16 emulator. The earlier on-chain wallet, Taproot, PSBT, fee-bump and transaction-history features remain available.

Fixes the optional push-notification crash when Firebase is unconfigured, including refresh callbacks from jobs queued by an older APK. Firebase remains unconfigured. Current-source software and native regression checks passed, including public XBT sync. The installed signed APK passed QR decoding, QR/text switching, scrolling, complete clipboard copy/paste, and foreground resume. Parent disposable-chain payment and recovery checks cover unchanged Lightning bridge code. Physical-phone and funded live payment testing remain open. Tor and continuous background operation are unsupported.

Earlier `.lightning` testing builds retain their separate wallet and node data.

Requires Android 8.0 or newer, on arm64-v8a or x86_64. Retain offline wallet backups and the separate Lightning recovery files before updating. Do not downgrade encrypted storage.
