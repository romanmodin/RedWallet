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
errors. Clean-runner regression/build and exact Caffeine publication pending.
