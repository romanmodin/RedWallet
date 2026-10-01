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
user password/recovery phrase or funded transaction used. Published as Caffeine v38 / public0.36. All372 reviewed paths match the
actual export /workspace/scratch/redwallet (34).zip byte-for-byte. Backend
Wasm690890bytes SHA2566726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001
unchanged. Source commit a30005fd72d572b84dae74d51fd43f7ee52be77f.
Source ZIP SHA256f197507fbc06561253106e74eb114562c29e5af94b79a67376ffb06fea8472e3.
Live Chromium disposable BIP84 fixture unlock PASS, input focus released,
viewport unchanged, document width485 / innerWidth500 (no overflow). This
is not a reproduction of iPhone Keychain zoom; actual phone result pending.

Public Settings0.36/home bridge connected/analytics script blocked verified.
Screenshot: /workspace/scratch/7be288640ecb/redwallet-036-published.jpg.
