# Version 11 production

Caffeine confirmed Version11 successfully deployed to production. Complete source preserved in80d425ccf. Production canister7gylz-gyaaa-aaaab-qhjrq-cai probe passed2026-09-29T19:43:36.421Z: height974737, exactcheckpoint961640, public BIP84 balance0/0, history176, fee1000sat/kB, emptyUTXOs,175byte rawtransaction, malformedtxid rejected. Bridge remains imagea384b17c as documented in V10 deployment record.

V11 vault lifecycle eight focused tests and typecheck passed locally. Caffeine retained219frontend/31files,67bridge,13PocketIC reported passing; PocketIC success outcalls remain outside that lane. Settings donation exact nativeaddress remains available and collapsed by default.

WATCH-ONLY: seed/recovery/sign/send UI not enabled. Source verification notes claiming bridge undeployed are historical and superseded by live probes above.

Before enabling browser key UI, inspected live HTTPS root: no CSP header/meta and Caffeine injects remote analytics script from cdn.caffeine.ai after app script in head. Sent narrow CSP hardening task; pending actual production enforcement verification. No claim that existing analytics exfiltrates keys (no key UI exists). Native worktrees and secrets untouched.
