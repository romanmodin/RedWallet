# Candidate visual signing evidence (prepared, not approved)

Candidate source 5ac15b5eeb26296d69008a39e7ff1b4e23d4f8c5 is still unqualified for signing. Focused run42234792388 must complete successfully and its exact ZIP API digest must be verified. Run verify_visual.py EVIDENCE_ROOT MANUAL_REVIEW_JSON OUTPUT_JSON only after inspecting all nine named screenshots. Manual review binds their exact hashes, source, run, attempt and harness. Never generate a positive manual receipt from OCR alone.

The gate independently reads runtime and screenshots from the digest-bound ZIP and rejects incomplete native outcomes, late capture, a different process, missing frames, stale source and unreviewed pixels. It does not claim physical-phone or funded-recovery testing.

This preparation does not change the active signing workflow or source/build pins. After qualification, wire this verifier before protected credential access alongside existing native/source gates, then update immutable signing pins in a separate reviewed change. Build8 retains its original receipts. No Apple changes are authorized by this offline check alone.
