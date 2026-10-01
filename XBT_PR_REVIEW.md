# Native RedWallet PR #1 review follow-up — 2026-10-01

Thank you to **@kwsantiago** for the seven detailed review comments on
[PR #1](https://github.com/romanmodin/RedWallet/pull/1#pullrequestreview-5380883623).
All seven concerns were valid, with the limits described below. This follow-up
changes the native wallet branch; the separate RedWallet Web branch is untouched.

| Review concern | Result |
| --- | --- |
| Verbose coinbase recognition | Recognize both null-prevout inputs and Knots/Fulcrum `coinbase` inputs. Enforce the existing conservative 6,480-confirmation policy in selection and signing. |
| Checkpoint trust wording | Describe the pinned header comparison as a compatibility check. It does not authenticate a server or prove its current chain. |
| BTC-origin replay and external links | Show a shared-seed replay notice during recovery and in XBT wallet details. Remove inherited BTC/Lightning/BlueWallet OS URL registrations and gate OS navigation. Explicit address scanning and confirmed clipboard payments remain available; an address cannot identify its intended chain. |
| Fee bumping | Enable the XBT type in send, RBF, cancellation, CPFP, and transaction helpers. Dispatch through the XBT signer and keep replacements eligible for further fee bumps. Accept both current Knots output-address JSON and normalized address arrays. |
| Unsigned PSBT sighash | Declare `SIGHASH_ALL | SIGHASH_UNIFIED` (`0x21`) on every input before returning an unsigned PSBT. Signing an already-declared input no longer duplicates the field. This does not enable or certify hardware signing. |
| Inherited signing-wallet types | Reject unsupported signing types before loading any wallet in a storage bucket. Preserve the original data and block subsequent writes from the failed loader. Existing watch-only records remain read-only. Android now uses its own application ID and matching preference group. |
| Upstream crash reporting | Disable Bugsnag initialization and reporting in JS, iOS, and Android, and remove upstream reporting keys/build hooks. Android no longer applies the upstream Firebase configuration. |

## Replay evidence and limits

The running home node reports `v29.4.2.knots20260508`. Its corresponding
[Knots ECDSA checker](https://github.com/bitcoinknots/bitcoin/blob/v29.4.2.knots20260508/src/script/interpreter.cpp)
uses the Unified digest only when the signature sets the Unified bit. Otherwise
it retains the previous signature algorithm. The matching local source was also
read. A BTC-origin spend can therefore be replayable on XBT when its inputs still
exist there and all other consensus conditions hold. RedWallet's `0x21` signatures
protect its XBT spends in the opposite direction; they do not remove this risk for
shared unspent coins. No wallet funds were moved to test or address this concern.

## Validation

- Full local unit suite: 66 suites, 622 passed, one skipped.
- TypeScript, repository lint and metadata checks passed.
- Native plist/XML checks confirm the new URL registrations and absence of
  upstream reporting keys.
- Regression coverage includes verbose immature/mature coinbase rewards,
  unsigned PSBT serialization, encrypted and mixed storage rejection without
  rewriting data, external-link filtering, disabled crash reporting, and RBF,
  cancellation, and CPFP signatures verified against the Unified digest.
- The existing Knots acceptance fixture still reproduces the exact signed
  transaction. Its signatures still fail independent Bitcoin BIP143 verification.

## Release limits

This is a draft PR update, not a release or merge. Fresh native CI builds and
physical-iPhone QA of these changes remain required before distributing an updated
TestFlight build. No production transaction was signed or broadcast in this review.
The Android application-ID change installs RedWallet separately from BlueWallet;
it does not automatically migrate an old BlueWallet installation's data. The iOS
bundle ID remains unchanged.

## iOS CI follow-up

The first post-review iOS simulator build failed because an inherited Xcode
source-map upload phase still required the removed Bugsnag API key. Removed
the source-map phase and both dSYM upload phases from the project, including
the watch target. Removed the watch initializer and remaining watch/widget
reporting keys as well. Native build verification is recorded separately from
the passing unit and Android UI checks.
