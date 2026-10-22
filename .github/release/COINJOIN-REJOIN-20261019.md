# Cancelled CoinJoin attempt retry correction

User reported `Invalid persisted round transition` after a failed join and cancellation on iOS build 1792439689 (source 9f627fb87b4b6cc28cddcf6ad45e2edc721551a8).

## Reproduction
An isolated regression creates a wallet journal, joins a pool, cancels before signing, and attempts to join the same pool again. Before correction it fails at WalletJournalStore.save with the reported error. Retained local log: /tmp/redwallet-rejoin-before.log. No real wallet, relay participation or funds were used.

## Correction
New attempts use their fresh join public key as a local attempt identity. Only an aborted unsigned journal can be replaced by a new joined attempt with a different identity and no inherited review. All ordinary transition, reservation and commitment guards remain. Signed, uncertain and complete journals cannot be replaced.

A prior callback carrying the old identity cannot mutate the replacement attempt. Encrypted session storage also includes the attempt identity, so late old session writes cannot overwrite new ciphertext. Legacy journals and vault namespaces remain readable; legacy unsigned aborted journals can start a new identified attempt.

## Validation and limits
Regression coverage includes same-pool retry with an equal deadline, legacy cancellation, stale writes, persistence rollback, active/signed/uncertain/complete rejection and vault isolation. Check CI on the PR's actual head for hosted results.

The earlier generic relay/message error is separate and remains undiagnosed. This correction does not claim full mobile CoinJoin interoperability, successful live mixing, or delivery to TestFlight. Do not manually remove signed reservations or weaken review/sign/broadcast assertions.

## Verified local validation

The reproducer failed before the correction with `Invalid persisted round transition`. After the correction: 112 suites / 1038 tests passed, one inherited skip. After adding allowlisted relay diagnostics: all 17 focused rejoin/vault/diagnostic tests passed; full lint and TypeScript passed. Relay diagnostics distinguish connection, subscription and participant processing failures without echoing untrusted exception text.

The user supplied another joining/zero-participant screenshot. The underlying relay or participant-processing failure is not yet identified or fixed. This change does not automatically retry joins or release signed/uncertain reservations. Hosted native qualification and delivery remain pending.
