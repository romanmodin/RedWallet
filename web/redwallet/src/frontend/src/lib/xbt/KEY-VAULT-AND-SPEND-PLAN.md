# Browser wallet foundation

These reviewed modules are now integrated into the local0.37wallet workflow.
The v7 watch-only/unmounted posture is historical. Current deployment evidence
and remaining limitations are in [release status](../../../../../RELEASE-STATUS.md).

## Implemented

- English BIP39 validation, 256-bit cryptographic entropy for new 24-word phrases,
  optional NFKD-normalized BIP39 passphrase, and native RedWallet's BIP84 account
  `m/84'/0'/0'`, receive/change branches 0/1.
- BIP32 5.0.1 with noble secp256k1 3.1.0. The native bip39 3.1.0 package failed the
  browser-without-Node-globals test because it assumes global Buffer. Browser code
  instead uses scure-bip39 1.6.0, compatible with noble-hashes 1.8.0. Published BIP84
  receive/change vectors and a browser-bundled round trip validate compatibility.
- Versioned AES-256-GCM ciphertext, 128-bit authentication tag, independent random
  16-byte salt and 12-byte nonce, PBKDF2-SHA256 at 600,000 iterations. Header/profile
  and public account metadata are authenticated as additional data. Only fixed
  supported parameters and bounded payloads are accepted before expensive work.
- VaultController persists ciphertext only, refuses existing-vault replacement,
  surfaces storage failures, cancels pending unlocks on lock, and locks on pagehide,
  background visibility, storage replacement, and a five-minute unlock timeout.
- Parent-transaction txid/outpoint/value/script/ownership checks; confirmed-only
  P2WPKH coin selection using integer satoshis, duplicate detection, conservative
  vsize fees, exact change/dust handling, and a 0.01 XBT maximum fee.
- Review digest binds every input, recipient, amount, change index and fee. Signing
  revalidates and reconstructs the canonical plan and uses the previously verified
  native XBT Unified Sighash core with 0x21. Changed reviews and locked/mismatched
  wallets are rejected. No broadcast occurs.

## Limits and release gates

Seed material exists in JavaScript memory while unlocked. Buffers are zeroed where
possible, but JavaScript garbage collection prevents a guarantee that every copy is
erased. Password encryption does not protect an unlocked wallet from malicious page
code or a compromised origin. The public xpub is stored unencrypted and is sensitive
wallet-activity metadata. No server receives the vault through these modules.

Coinbase inputs are rejected; native/network-specific maturity integration remains
unfinished. Unconfirmed inputs, Taproot, legacy outputs, RBF UI, HD gap discovery,
and multi-account recovery are not implemented here. The planner trusts the caller's
chain-height observation and does not provide SPV proof validation. Integration must
require a fresh checkpoint-verified bridge status and current UTXOs before signing.

Required before enabling real deposits/spending: backup confirmation and recovery UI,
storage-loss messaging, production CSP/dependency review, HD discovery, bounded UTXO
and raw-parent reads through the configured canister/bridge, review-state lifecycle,
constrained broadcast with exact txid checking/deduplication, fresh activated-XBT
acceptance and BTC replay-negative tests, and actual browser/iPhone validation.

The browser harness uses public, unfunded test vectors only. Never use them as wallet
keys. Existing recorded Knots acceptance remains fixture parity, not a new transaction
accepted by a live node in this continuation.

References: native RedWallet source eebada6df427874e4be03bfd89041d04ff364ae5;
https://github.com/bitcoin/bips/blob/master/bip-0084.mediawiki;
https://www.w3.org/TR/WebCryptoAPI/;
https://github.com/paulmillr/scure-bip39/releases/tag/1.6.0.
