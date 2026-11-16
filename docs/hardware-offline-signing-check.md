# Offline hardware signature check

This diagnostic creates an intentionally invalid-funded PSBT and checks a returned signature. It helps qualify Native SegWit PSBT origin, change and standard SIGHASH_ALL interoperability without depositing coins, importing a seed or accessing a live node. It is separate from the app and does not enable RedWallet's standard-hardware release switch.

The funding transaction contains duplicate inputs, so it violates consensus on both chains. A signed child cannot become a real payment. The tool contains no network or broadcast operation. Never fund the displayed addresses or try to broadcast the fixture. A hardware device may reject the deliberately invalid parent; record that limitation rather than enabling unsafe device settings or replacing it with real funds.

## Public account input

Export the intended **Native SegWit public account** using the device's supported account export. Keep the seed, passphrase and private keys on the hardware device. Do not reset an existing device or load a public test seed. The account fingerprint/path must come from the same device export. If a passphrase account is used, select that same account on the device.

Create a local `public-account.json` with exactly these fields, substituting the exported public values:

```json
{
  "fingerprint": "1234abcd",
  "accountPath": "m/84'/0'/0'",
  "xpub": "YOUR_EXPORTED_MAINNET_ACCOUNT_XPUB_OR_ZPUB"
}
```

The example is a template, not a working account. Only mainnet-encoded BIP84 account xpub/zpub values are accepted. The tool verifies checksum, depth and account index; a valid signature proves control of the derived key, but cannot independently prove the exported master fingerprint or path against a device seed. Verify those public export details on the device. Public account exports expose wallet history and should stay local; do not post them or personalized fixtures to GitHub.

## Generate and review

Use the repository's already prepared Node dependencies, with Node 24:

```sh
node scripts/diagnostics/hardware-signing-fixture.cjs generate public-account.json offline-hardware-test
```

The output directory must not exist. Files are created with owner-only permissions. Read `review.json` before using the device. The binary request is `OFFLINE-TEST-NEVER-BROADCAST.psbt`; a Base64 form is also included.

Expected virtual values are 100,000 input sats, 40,000 recipient sats, 59,000 change sats and 1,000 fee sats. Input origin is the exported account followed by `/0/0`; change is `/1/0`. SIGHASH must be ALL (0x01). Check the complete recipient and change addresses against `review.json` on any device screens that display them. These are virtual fixture amounts, not a balance or transfer.

Use the hardware device's supported offline PSBT import/export workflow. Record the exact model, firmware, import/export transport, displayed amounts/fee/addresses, whether change is recognized, and approval or refusal. Device menu paths and support are not assumed by this diagnostic. Save its signed PSBT or final transaction hexadecimal locally. Keep an original copy of the signed return for any later app interoperability check.

## Verify the return

```sh
node scripts/diagnostics/hardware-signing-fixture.cjs verify public-account.json signed-return.psbt offline-signature-receipt.json
```

The tool accepts binary/hex/Base64 signed PSBTs or final-transaction hex. It rebuilds the request from the original public account and rejects any changed input, output, amount, sequence or locktime, wrong key, invalid signature or non-ALL sighash. It creates a new success receipt only after cryptographic verification; existing files are never overwritten. Canceling or refusing the signing request produces no success receipt. Do not substitute a normal wallet transaction as the test request.

## Qualification limits

A passing receipt proves an offline signature matches this fixture. It does not itself prove that a physical device signed it, qualify live XBT separation evidence, mobile camera/file transport, the complete RedWallet approval/broadcast flow or real-money operation. Record operator-observed device details separately. Host-simulated test signatures must never be recorded as physical-device passes.

Repeat with Keystone and OneKey separately where their firmware supports the required exchange. Refusal or unsupported transport is an outstanding interoperability result, not permission to weaken verification. Physical RedWallet end-to-end testing and the remaining release gates still apply. No real-fund test is authorized by running this diagnostic.
