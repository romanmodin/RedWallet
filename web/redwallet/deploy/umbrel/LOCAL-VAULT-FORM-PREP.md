# Prepared local vault form (not live)

LocalVaultPanel is intentionally not mounted on any application route. A narrow isolation-test exception permits this exact client form; a separate invariant rejects imports that would mount it before deployed CSP verification and integration review. This implements the user's full-wallet goal without exposing key entry in the current published watch-only app.

Supports 24-word cryptographic generation, three-word backup challenge before persistence, BIP39 recovery with optional exact passphrase, password confirmation, ciphertext-only catalog persistence, orphan-safe labels, authenticated unlock before public address display, manual/background/pagehide/storage-change/unmount locking, and cancellation-generation guards around asynchronous crypto. It has no RPC or signing/broadcast call and reports that discovery/spending integration remains required.

Four form tests passed: public-fixture recovery/unlock/lock with zero fetches and no plaintext persistence; backup challenge required for generated disposable test wallet; invalid recovery/background field clearing; cancel during actual encryption prevents a hidden saved wallet. Four isolation tests and TypeScript passed.

Next: review full component lifecycle, integrate via application context/Wallets only after the actual public CSP passes; add bounded discovery, multi-address integer balances/history, then reviewed signing/broadcast. Do not call this a deployed or complete spending wallet.
