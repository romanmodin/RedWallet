# RedWallet0.38: production dependency security cleanup

The2026-10-01 pnpm10.14.0 production audit of0.37 found9advisories:
1critical,3high,4moderate,1low. This is package inventory evidence, not a
reproduced wallet exploit or evidence of compromise.

| Package/path | Action |
| --- | --- |
| seroval1.5.1 through TanStack router-core |Pin reviewed patched1.5.3 using web-only workspace override |
| lodash4.17.23 through Recharts |Pin reviewed patched4.18.0 using web-only workspace override |
| lodash-es/Quill through react-quill-new |Remove unused editor dependency |
| js-cookie through react-use |Remove unused hooks dependency |
| fflate through drei/three-stdlib |Remove unused3D packages and their types |

Removed direct packages: react-quill-new, react-use, @react-three/cannon,
@react-three/drei, @react-three/fiber, three and development @types/three.
Source import search found no usages. The retained chart component still has
Recharts; no product component/file was deleted. Cryptographic dependencies,
direct router version, keys/signature rules, bridge/backend and0.37Safari
focus guard unchanged. No broad package upgrade or audit exceptions.

Sources: https://github.com/advisories/GHSA-mv8w-475r-vwqw,
https://github.com/advisories/GHSA-r5fr-rjxr-66jc,
https://github.com/advisories/GHSA-f23m-r3pf-42rh,
https://github.com/advisories/GHSA-qjx8-664m-686j,
https://github.com/advisories/GHSA-v3m3-f69x-jf25,
https://github.com/advisories/GHSA-px8p-9vwx-vf98.
The seroval advisory concerns untrusted fromJSON deserialization/plugins and
downstream server frameworks; RedWallet's runtime exploitability was not proven.

Frozen-lockfile install on Zorin PASS. New production audit exit0 with0known
advisories and200dependencies, previously301. Local and Zorin lock SHA256:
4970900f13c68959160c46f60a5c7d78881e64add8d6f7289f3644fd8322e7ca.
Audit artifacts: /tmp/redwallet-production-audit-20261001.json and
/tmp/redwallet-038-audit.json on Zorin. New GitHub step audits production
packages at every web push/PR and fails on reported vulnerabilities or audit
errors.

Clean GitHub runner PASS at source188c6e28ba5fc64c2d8c633718a9cddcdc2d898c:
https://github.com/romanmodin/RedWallet/actions/runs/36910218269.
All steps passed: locked install, production audit, frontend typecheck/lint,
63files/382tests and build, bridge typecheck/tests and build.
Caffeine40/public0.38 LIVE on2026-10-01 after user restored sign-in.
Actual export redwallet (36).zip matches all376reviewed source files byte for
byte. Published backend SHA256 unchanged:
6726b411d9be5eb91b8a7f31ad18c9e415da13dc4b948b49fe027ec005a05001.
Public Settings reloaded:0.38 and external analytics blocked.
Frontend382tests and bridge80tests passed; total462.

Live Test connection PASS: built-in service connected through primary home
Umbrel HTTPS bridge. No funded transaction was submitted.
