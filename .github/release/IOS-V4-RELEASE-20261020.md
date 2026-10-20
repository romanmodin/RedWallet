# V4 release preparation — pending qualification

Pins the enabled v4 candidate and required exact-source software/general iOS/funded iOS runs. PR74 must qualify and merge first; then update this branch against actual main and verify unchanged production mapping before merging orchestration. Do not dispatch old main pins or interpret this draft as qualification.

The update includes Kilojoin v4 two-to-five equal outputs per participant, v3 one-output compatibility, separate fresh-address/output registration, count-aware fees and signing review, authenticated pre-join history handling, and unsigned same-pool retry repair. Experimental opt-in and explicit signing/broadcast remain. Existing separate coin-label PR63 is not included.

User authorized TestFlight delivery and replacing the Apple submission with v4 on2026-10-20. The read-only inspection at11:50:55Z still showed8.0.1(1792439689) WAITING_FOR_REVIEW. Keep that submission until the qualified new IPA is uploaded, processed and ready to replace it.

After gates pass: guarded merge PR74, update/verify this branch, merge, dispatch one protected signing/upload plus required fresh captures after duplicate checks. Verify actual upload/source/signatures; update beta pins only from its receipt, distribute to existing groups and verify availability. Prepare replacement submission from actual receipts; verify current old build/review IDs before cancellation and stop on any unexpected state. Wait for cancellation to become terminal, select the new build, refresh qualified-source privacy URL and reviewer notes, submit and GET-verify status. No blind mutation retries or new legal acceptance. Do not claim upload/submission from this preparation.

## Verified progress 2026-10-20 08:07 EDT

Exact-source software CI 39418562475 passed. The committed 2bb307367 source passed six real reference-peer/loopback-WebSocket/disposable-Knots rounds: one, two and five outputs for each SegWit/Taproot type. Every raw transaction matched and was accepted and confirmed once; peer networking was disabled. The upstream Kotlin sources remain pinned to Kilowallet 1.2.0 commit 6fbff814de8a59d6c4879724bcb1ae772182a0f1. This does not establish physical-phone interoperability. Native general and funded runs remain pending.

Prepared `replace-ios-review.mjs` is an offline-tested module with no credential access or CLI entrypoint. It is not wired to the submission job and performs no live action during PR tests. Thirteen tests cover exact old review identity, replacement Apple/TestFlight readiness, unrelated review/build preservation, pending cancellation, and uncertain-write behavior. The existing submission verifier still pins the prior actual release; repin and integrate only from the eventual new verified receipts.

Apple documentation checked: https://developer.apple.com/documentation/appstoreconnectapi/reviewsubmissionupdaterequest/data-data.dictionary/attributes-data.dictionary (the official documentation JSON exposes boolean `canceled`) and https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/remove-a-submission-from-review/. Cancellation can be asynchronous and returns the version to Developer Rejected; the later submission integration must allow that verified editable state, extend read-only paths for beta readiness, and preserve all exact-source/package/screenshot gates. Never retry a cancellation after an uncertain response without inspecting the live state and retained receipt.

Live read-only Apple inspection 39417792914 at 2026-10-20T11:50:55.472Z confirmed the old build 1792439689 remains WAITING_FOR_REVIEW. No withdrawal, new upload, new distribution or v4 submission has happened.

The integrating runner must reload the retained withdrawal report after an interrupted/uncertain attempt. The helper refuses a second cancel while that report remains unresolved, even if Apple still shows the old waiting state. It can observe CANCELING or completed removal without repeating a write.

## Prepared reviewer / TestFlight feature note

This update adds experimental Kilojoin v4 compatibility in Settings > Tools > CoinJoin, developed for interoperability with Kilombino's Kilojoin/Kilowallet protocol. A v4 pool can specify two to five equal mixed outputs per participant; one-output v3 pools remain supported. Each output uses a separately reserved fresh wallet address, and the transaction review shows output count, denomination, total, change and fee before signing. Live participation requires explicit opt-in. CoinJoin does not guarantee anonymity; the relay can observe network connections and the configured backend can observe address queries. This update also repairs same-pool retry handling and ignores authenticated roster history from before the participant's welcome without relaxing current-roster validation.

Use disposable test wallets for testing. The interoperability receipt uses an isolated Knots regtest node and public test fixtures, not real funds. It is not proof of physical-phone round completion or ColdWallet interoperability. The separate coin-color/suggestion proposal in draft PR63 is not part of this candidate. The actual TestFlight build number and upload identity must be inserted only from the new upload receipt.
