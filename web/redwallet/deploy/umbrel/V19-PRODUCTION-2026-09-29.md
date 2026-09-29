# RedWallet v19 production verification

Caffeine confirmed: "Success! Version19 is live in production!"
Public page: https://redwallet-7m3.caffeine.xyz/wallets
Production backend:7gylz-gyaaa-aaaab-qhjrq-cai.

All286 files in the final reviewed ZIP matched exported v19 source byte-for-byte.
ZIP SHA256:40579a3bc3be23c0ad18192eb370c22950250f83877aa7cc920aef4ee2865c58.
Source Git commit:ea8083108d39b21b4fd5f312d567770e0bc53d22.

Local verification:51files/303frontend tests passed; after the final reconnect
fix, the2workspace tests passed again. Final lint187files, TypeScript and build
all exit0. Backend/bridge code is unchanged from v17, whose Motoko15, PocketIC14
and bridge79 tests passed. No skipped PocketIC result is counted as passing.

Actual production browser (Chrome cloud) showed Connected and passed:
"Local encryption and XBT signing self-test passed. No transaction was broadcast."
The check uses only the published disposable isolated-regtest fixture. It
accesses no saved wallet, stores no test keys and makes no broadcast/network call.
CSP gating was naturally satisfied by the actual enforced analytics block.
The public disposable encrypted test wallet unlocked successfully; deployed
account-read and XBT-payment-preparation controls rendered. Preparation remained
disabled until a fresh scan. The test wallet was locked again afterward.
Screenshot:redwallet-v19-live-self-test.jpg records the actual release UI.

Production anonymous probe at2026-09-29T21:51:37.890Z:height974754,
checkpoint verified, broadcastEnabled=false, malformed signed input rejected.
Full read probe at21:52:04.282Z passed balance0/0, history176, fees1000sat/kB,
UTXOs0, raw175bytes and invalid input rejection. The fixed XBT checkpoint remains
height961640/hash0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb.

Sending is STILL DISABLED. The full local flow is deployed behind the bridge
capability gate; actual iPhone validation remains open. Ask the user to open
Wallets on iPhone and run the no-funds self-test, reporting only the result.
Do not ask for a seed/password. Actual iPhone end-to-end wallet usage and an
actual mainnet transfer have not been verified or claimed. Financial submission
is a user action. See V18-PAYMENT-UI-2026-09-29.md for subsequent activation steps.
The Settings donation card retains the native address. Native worktrees,
operator credentials, private ports and ingress were not changed.

An automatic publication review initially mistook a historical pre-v14 eight-lint
failure for the v19 state. Fresh clean release checks, exact export comparison
and Caffeine's v19-success message proved the current prerequisite; the retry
was accepted and publication completed. No safeguard was bypassed.
