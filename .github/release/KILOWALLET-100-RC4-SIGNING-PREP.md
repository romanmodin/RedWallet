# RC4 signing preparation — not active

Prepared on November 5, 2026 from publisher orchestration main73c76e6283587e55dba267997b8e6303bab6f996. The current app candidate is764646886484a7ed302b89227ded3ad1ff052a4e, native42014957376 attempt1 and screenshot checker42015040254 attempt1. This branch does not advance source/gate pins, dispatch signing, or authorize upload.

The 1.0 native qualification verifier now also requires successful execution of the asynchronous-round/signed-reservation regression gate and the three pinned engine-fetch/hash-check steps. Missing, duplicate, skipped, failed or unfinished required steps remain disqualifying even when a workflow is otherwise successful. All prior source/tree/current-attempt/package/signature/processing guards remain.

Twenty offline release-safety cases passed. A new regression explicitly rejects skipped or missing async and LND/Ark/Tor checks. Actual read-only preflight against the unfinished RC4 native run was rejected before signing or credential jobs, as expected. Evidence is retained at /home/roman_modin/kilowallet-release-evidence/rc4-signing-prep-20261105; preparation receipt SHA25615d278f846e28165f697b06e8d2649aaa41e2cd4610a7f6330b2e6ce2dfd0259.

Do not activate with the historical59b13da source or rejected build5. First finish exact RC4 native qualification, download/verify actual artifacts, inspect68screens/runtime/XML/arm64/source tree, and guarded-merge the app. Then advance source/gate pins using those actual receipts and run the necessary coordinator checks. Resolve supported Apple encryption handling independently before protected signing/upload. Preserve existing App Store review and original beta groups. No funds or existing wallet data used.

The provided KjLabInteropTest is optional unless configured. It requires the maintainer lab's authenticated loopback RPC, command wrapper and service controls, which the public onion faucet/relay/Electrum coordinates do not supply. Two unconfigured no-op cases must never be reported as joint interoperability proof. No lab or node configuration was changed.
