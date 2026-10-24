# Kilojoin welcome decoding on the shipped Hermes engine

The iOS lockfile at delivered source
`286e875cb488365eeb00799b6c04305994ab9db7` pins
`hermes-v250829098.0.10`, commit
`becc964bd16002569bf74c4d8c190cfd2ad38985` in facebook/hermes.
The app's shim uses `buffer@6.0.3`. That Buffer inherits `subarray` from
Uint8Array. This Hermes version returns a plain Uint8Array, so calling
`toString('utf8')` on the result produces comma-separated byte values.

Kilojoin decrypt correctly verifies the MAC and padding, but then used that
method to decode the plaintext. The UTF-8 round-trip check consequently rejects
valid welcome messages with `Invalid UTF8`. The participant remains in
`joining` with zero accepted seats. The fix explicitly wraps the byte view in
`Buffer.from` before decoding; the MAC, padding, UTF-8, event signature and replay
checks remain intact. The delivered crypto file has the same faulty decoder as
the local baseline. The user phone's exact error remains unobserved; this is a
reproduced engine-level defect matching its visible state, not a physical-device
or live-round qualification receipt.

## Actual engine reproduction

Build the unmodified upstream engine tag using the official standalone build
instructions. On the Linux diagnosis host, CMake Release used
`HERMES_UNICODE_LITE=ON`, `HERMES_ENABLE_INTL=OFF`,
`HERMES_ENABLE_DEBUGGER=OFF`, and `HERMES_ENABLE_TEST_SUITE=OFF`.
The Unicode-lite configuration avoids host ICU development dependencies. This
is the actual JavaScript VM, not a replacement for iOS/native Keychain testing.

Install diagnostic-only `esbuild@0.25.12` outside the app repository. From the
repository root, with `REDWALLET_ESBUILD_MODULE` pointing to its module directory:

```sh
node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/kj-before.js 496d1433e415127592b0ee81b6e8cc24418a6414
node scripts/diagnostics/build-hermes-kilojoin.cjs /tmp/kj-after.js
/path/to/hermes/build/bin/hermes /tmp/kj-before.js > /tmp/kj-before.json
/path/to/hermes/build/bin/hermes /tmp/kj-after.js > /tmp/kj-after.json
```

The baseline option replaces only `crypto.ts` with the named git revision, so
the comparison isolates decoding from the previously prepared startup fixes.
The bundle uses the app's actual Buffer and text-encoding packages. It does not
monkey-patch TypedArray behavior. Inspect the emitted JSON, not just process
exit status: the diagnostic catches failures to report all cases.

Expected before: Hermes=true, subarrayIsBuffer=false, 4 passed/25 failed;
all 12 actual Kotlin startup exchanges stop at joining/0 with Invalid UTF8.
Expected after: 29 passed/0 failed; all 12 reach voting with their expected 2 or
5 participants. Coverage includes P2WPKH/P2TR, 1/2/5 outputs, reversed initial
history, 11 Kotlin ciphertext lengths, authenticated envelopes/replay, multibyte
UTF-8, corrupt MAC rejection, RFC9474 blind/unblind/tamper, and both actual Kotlin
transaction-signature fixtures.

All inputs are existing public synthetic fixtures. Storage/chain observations
are offline test doubles; publication throws. No real identities, wallets,
network connections, spending signatures or broadcasts occur.

## Fast regression check

```sh
node node_modules/jest/bin/jest.js --runInBand --runTestsByPath tests/unit/xbt-kilojoin-hermes-buffer.test.ts
```

This suite models the confirmed Hermes subarray behavior using the actual npm
Buffer, restoring globals afterward. Its 31 checks also reject authenticated
invalid UTF-8 and dirty padding. It complements the standalone engine run and
the existing on-device startup self-test; it is not a native execution receipt.

Primary references:

- https://github.com/facebook/hermes/blob/becc964bd16002569bf74c4d8c190cfd2ad38985/lib/VM/Operations.cpp
- https://github.com/facebook/hermes/blob/becc964bd16002569bf74c4d8c190cfd2ad38985/lib/VM/JSTypedArray.cpp
- https://github.com/facebook/hermes/issues/1495
- https://github.com/romanmodin/RedWallet/blob/286e875cb488365eeb00799b6c04305994ab9db7/class/xbt/kilojoin/crypto.ts
