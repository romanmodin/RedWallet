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
