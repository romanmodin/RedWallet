# Combined iOS candidate, October 19, 2026 UTC

Prepared for the owner-requested iOS-first release. Android delivery is deferred.

Includes current main (skin/artwork default off, containment and frozen-output protection), PR44 ancestor CPFP, PR48 nonblocking chain freshness, and PR47 authenticated hot BIP84 RBF. External BIP84 signing and legacy fee paths remain contained.

The first funded iOS candidate (71aba221) reached authenticated native send and RBF, preserved the recipient, rejected a declined high-fee action without broadcasting, then accepted the replacement in isolated Knots. Run39179795783 failed afterward: Done did not return to the wallet. Its retained screenshot shows the Success screen. Success is registered both in the send modal and directly in the wallet stack; the old handler always called parent.goBack(), which cannot pop the direct wallet stack. The corrected handler pops to the existing wallet route without returning to the signing forms, and retains modal closing for ordinary sends. Five regression checks pass. This is not a full native pass yet.

Local combined validation before the navigation fix: 94 unit suites, 914 pass, one inherited skip; full lint/typecheck pass with one inherited encryption warning. Navigation fix focused tests and TypeScript/ESLint pass. Exact combined-source hosted unit/lint, general iOS UI and funded native iOS qualification remain mandatory before release. Checkouts now pin the actual candidate head, including simulator build and test jobs.

All backend tests use disposable loopback regtest services and public fixtures. Hosted results are not physical-iPhone or cold-device interoperability evidence. No TestFlight upload or App Store submission is claimed by this document.
