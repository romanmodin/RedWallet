# V4 release preparation — pending qualification

Pins the enabled v4 candidate and required exact-source software/general iOS/funded iOS runs. PR74 must qualify and merge first; then update this branch against actual main and verify unchanged production mapping before merging orchestration. Do not dispatch old main pins or interpret this draft as qualification.

The update includes Kilojoin v4 two-to-five equal outputs per participant, v3 one-output compatibility, separate fresh-address/output registration, count-aware fees and signing review, authenticated pre-join history handling, and unsigned same-pool retry repair. Experimental opt-in and explicit signing/broadcast remain. Existing separate coin-label PR63 is not included.

User authorized TestFlight delivery and replacing the Apple submission with v4 on2026-10-20. The read-only inspection at11:50:55Z still showed8.0.1(1792439689) WAITING_FOR_REVIEW. Keep that submission until the qualified new IPA is uploaded, processed and ready to replace it.

After gates pass: guarded merge PR74, update/verify this branch, merge, dispatch one protected signing/upload plus required fresh captures after duplicate checks. Verify actual upload/source/signatures; update beta pins only from its receipt, distribute to existing groups and verify availability. Prepare replacement submission from actual receipts; verify current old build/review IDs before cancellation and stop on any unexpected state. Wait for cancellation to become terminal, select the new build, refresh qualified-source privacy URL and reviewer notes, submit and GET-verify status. No blind mutation retries or new legal acceptance. Do not claim upload/submission from this preparation.
