# RedWallet0.37: prevent Safari focus zoom

User reports0.36 still fails to return to normal size after automatic Keychain
zoom. Manually typing or pinching out before autofill keeps normal size. The
post-success viewport reset is removed, not counted as successful.

Apply maximum-scale1 to regular iOS Safari only while unlock form is mounted.
React layout effect installs it before paint/focus. Preserve width, initial
scale, safe-area and other settings; restore exact viewport on form exit.
Keep password blur before disabling. Do not change Android, desktop or embedded
webviews. Safari manual pinch remains available per WebKit's documented Safari
behavior; do not apply this setting to Android where it restricts pinch.

Sources: https://webkit.org/blog/7367/new-interaction-behaviors-in-ios-10/
and https://bugs.webkit.org/show_bug.cgi?id=157771 (focus-specific behavior).
These support the mechanism; actual current iPhone Keychain result remains
unverified until the user checks0.37.

31focused tests PASS: vault6/viewport6/CSP15/manifest4. Typecheck, Biome219,
production build PASS. Lifecycle regression covers guard before password focus,
wrong-password retention, cancel and unmount restoration. No network/backend,
bridge, keys, scan state or native changes. Published Caffeine39 / public0.37. All373source entries exactly match
actual export /workspace/scratch/redwallet (35).zip. Backend Wasm SHA256
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001 unchanged.
Source64d4b1dadefb77054b3f7fd7822e687fc0d6494f. Source ZIP SHA256
c85b6e7d440201f8daab062346004e2440576904c3cf28e76021dbb1477b497b.
Public0.37 analytics blocked, disposable BIP84 fixture unlock authenticated
expected first address; focusBODY, normal viewport unchanged, width485 /
innerWidth500. No actual Safari/Keychain simulation possible in Chromium.
iPhone final check pending. Screenshot redwallet-037-published.jpg.

## iPhone confirmation

2026-10-01 11:12PDT: after being asked to check0.37 with Keychain, the user
reported: "Yes that did it." The reported retained automatic password zoom
issue is resolved on their iPhone. This is user device verification, distinct
from the earlier Chromium checks. Supersedes phone-check pending notes above.

Final full frontend regression:63files/382tests PASS after fixing an
existing callback timing assertion; typecheck/Biome219 PASS. No product
runtime changes in follow-up; public remains0.37. See V037-FINAL report.
