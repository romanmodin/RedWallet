# V7 donation Settings deployed — 2026-09-29

User requested the TestFlight donation option discreetly in Settings. Caffeine v7 is Current and Live, verified in version history and public browser.

- Public website: https://redwallet-7m3.caffeine.xyz/
- Settings contains Support RedWallet at the bottom, collapsed by default; aria-expanded false verified before expansion in draft and production.
- Donation address matches native TestFlight Settings.tsx: bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4.
- Expanded UI labels XBT (BLAKE2b), voluntary donation, raw-address QR, copy button. No payment is initiated.
- Rendered QR SVG path matrix independently matched qrcode.react rendering of the exact raw native address.
- Copy success feedback observed in direct draft and production. Actual clipboard readback exposed an old value through browser automation, so end-to-end clipboard contents remain unverified in this environment. Reviewed handler calls navigator.clipboard.writeText with the exact address constant, awaits success and handles rejection. Caffeine preview verified failure feedback; its headless clipboard access was denied.
- No exact test counts retained by Caffeine. Read-only report says build plan records compile/lint/build clean and suite passed, pre-commit status passed, local QA inconclusive only for clipboard success. Do not invent counts.
- Postdeployment production backend 7gylz-gyaaa-aaaab-qhjrq-cai passed verify-canister.mjs at 2026-09-29T16:05:53.832Z, exit 0: height974709, Fulcrum2.1.2/protocol1.4, checkpoint961640 correct hash0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb, public BIP84 test balance0/0, history176, fees1000sat/kB.

Source preservation: source-snapshots/v7/SupportSetting.tsx contains the complete verbatim component returned by the Caffeine read-only workspace report. It is evidence, not a fully synchronized source tree. Reported additional changed paths: frontend SettingsPage.tsx and settings-support-cover.test.tsx/settings-support-characterization.test.tsx. Complete v6/v7 ZIP export remains unavailable. Tracked main source still represents v5; do not claim full v7 source sync.

Wallet remains WATCH-ONLY. Full seed/recovery/signing/sending unfinished. Native worktrees and private bridge/operator configuration preserved. No funds sent.
