# RedWallet 0.33 — inline splash playback

The welcome video remains embedded in the main wallet page. Removed native
video controls, retaining muted autoplay and playsInline, and disabled picture
in picture and remote playback. This removes the native fullscreen/player
controls while keeping the existing Continue button, finish/error behavior,
first-launch preference and timeout. No new tab or video link is rendered.
The previous splash footer incorrectly showed 0.27; product metadata and footer
now show 0.33. Wallet, provider, backend, native app, keys and CSP unchanged.

## Validation

Existing splash tests now assert inline video, absent native controls/picture
in picture and no link. Splash and CSP/route/metadata suites: 2 files, 19 tests
PASS. Typecheck, Biome 216 files and production build PASS. Existing ancestor
React Native base-config and Browserslist warnings remain. Actual iPhone
playback requires user verification; no Safari behavior is claimed from jsdom.

## Publication

Caffeine project currently requires sign-in. Exact-source import, compiled
export comparison and production publication are pending; 0.32 remains live.

## Published — 2026-10-01 UTC

Sign-in restored. Caffeine internal 35 compiled and published as product 0.33.
Reviewed source ZIP: 363 files, 7190229 bytes, SHA256
 d3c5b330757b996ea4dd595640e0f4a5ee461ecd18b5663850fa7a2e9debbd4f.
Actual export /workspace/scratch/redwallet (31).zip: all 363 reviewed paths
match exactly, none missing or changed. Compiled splash includes playsInline,
disablePictureInPicture and disableRemotePlayback, with no native controls.
Actual backend Wasm remains 6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001,
the previously PocketIC-tested artifact. Public Settings shows RedWallet 0.33
and external analytics blocked. Public Network reports Connected, height 974954.
Screenshot redwallet-033-published.jpg saved. iPhone inline playback remains a
user check; use a new private tab to observe the existing first-launch intro.
No wallet data cleared, no keys accessed and no funded submission performed.
This supersedes the sign-in/publication-pending note above.
