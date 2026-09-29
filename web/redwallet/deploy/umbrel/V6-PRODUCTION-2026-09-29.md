# V6 production verification — 2026-09-29

Explicit user approval: Publish v6. Existing reviewed v6 promoted through Caffeine Go live. Version History marks v6 Current and Live; public site renders corrected watch-only action hints and synchronized connection indicators.

- Website: https://redwallet-7m3.caffeine.xyz/
- Production backend: 7gylz-gyaaa-aaaab-qhjrq-cai
- Anonymous verify-canister.mjs passed 2026-09-29T15:47:32.877Z, exit 0.
- Height 974707; Fulcrum 2.1.2, protocol 1.4.
- Checkpoint 961640: 0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb.
- Public BIP84 test address: confirmed/unconfirmed balance 0/0, history 176, fee 1000 sat/kB.
- Browser Network Refresh passed, header and Network card agree Connected.
- One probe during promotion received a replica rejection; postdeployment probe passed.

The app remains WATCH-ONLY. Seed creation/recovery/signing/sending remain unfinished.
V6 full source export remains unresolved; tracked implementation currently represents v5, with v6 review and deployment evidence. Do not claim v6 source is synchronized.

User subsequently requested a discreet donation option in Settings, matching native TestFlight. Native Settings.tsx read-only inspection confirms donation address bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4 and XBT (BLAKE2b) only label. Narrow Caffeine implementation requested; not yet verified or published at this checkpoint. Native worktrees untouched, private bridge/operator configuration preserved.
