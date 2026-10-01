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
bridge, keys, scan state or native changes. Publication pending.
