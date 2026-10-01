# RedWallet0.36: Safari Keychain zoom recovery

User verified0.35 did not resolve the issue. Keychain/password-field focus
zooms Safari and the scale remains after unlock; manual pinch out fixes it.

Unlock now blurs the password field before disabling it. After successful
unlock, zoomed iOS Safari receives a temporary initial/min/max-scale1 viewport
request, restored to the exact original viewport after350ms. Other browsers,
embedded iOS webviews and unzoomed Safari remain unchanged. No persistent
user-scalable restriction; no route-change zoom resets. Password/key handling,
network providers, backend and bridge unchanged.

Verification:29focused tests PASS (vault5, viewport5, CSP15, manifest4),
TypeScript/Biome219/build PASS. Tests cover focus release, temporary setting
restoration, unzoomed Safari/Android/embedded webview no-op and concurrent
viewport changes. These validate code behavior, not actual Safari zoom.

Public iPhone Keychain/autofill + pinch zoom check remains required. No real
user password/recovery phrase or funded transaction used. Publication pending.
