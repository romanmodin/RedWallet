# RedWallet 0.21 navigation update — prepared, not published

Local encrypted wallets now appear before watched/demo accounts in Wallets.
The mobile bottom bar includes Wallets. Home, Receive and Activity have clear
links to the protected local wallet workspace, with separate descriptions for
watched/demo data. Settings describes the wallet bridge without claiming it is
read-only. All key handling, CSP gates, transaction review and explicit
submission behavior remain unchanged. First-launch video is not reset.

Validation: main suite 305/307 passed; the two failures were stale expectations
for the deliberately changed network label. After updating those expectations,
the 15-test Settings/network/mobile-navigation lane passed. Typecheck, Vite
build and Biome also pass. This is not a funded transaction verification.

Production remains public 0.20 (Caffeine 21). Publishing 0.21 is blocked by
Caffeine returning the shared browser to sign-in. Import the exact complete
archive after authentication, compare export and verify the live mobile
navigation before claiming publication. Native worktrees remain untouched.
