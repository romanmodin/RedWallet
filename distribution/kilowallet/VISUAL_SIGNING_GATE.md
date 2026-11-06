# Qualified visual evidence for signing

Source `5ac15b5eeb26296d69008a39e7ff1b4e23d4f8c5` passed native run42182220263, checker42188560912, and focused run42234792388 attempt1. All nine Create, Settings and Lightning screenshots were manually inspected after the ZIP digest and CRC were verified. The immutable manual receipt binds image hashes, source, run, attempt and harness. It must never be generated from OCR alone.

Before protected credential access, fetch_verified_visual.py verifies the current GitHub run and artifact metadata, downloads only the pinned public evidence, and runs verify_visual.py against the ZIP bytes and manual review. It rejects incomplete native outcomes, late capture, a different process, missing frames, stale source and unreviewed pixels. The check repeats before the signing job imports credentials.

Evidence: artifact13515939118, SHA256 `005de209ee27a7c8847a192b71693623fadb533703f64b3f12393ac6a1114cbc`; harness8314fe533d246b73f20c46f77a9a28b4ae2fa927. Native qualification checked PR merge5cde91d9cb594879fc4cdfd97ca1631474505352 with the same tree803460785f25cfc0770cfa8b70639b27ca4435d2 as the source being signed.

This qualifies synthetic simulator rendering and native checks. It does not claim physical-device or funded-recovery testing, or persistent peer connectivity across background. The existing build8 keeps its original source and artifact receipts. The existing App Store review is unchanged.
