# Content Security Policy verification

Non-secret record of the restrictive browser Content Security Policy hardening
added to RedWallet. It contains no bridge URL, bridge secret, operator
principal, draft access-token URL, seed, or private key.

This revision is a frontend-only, static document-head and hosting-configuration
change. It does not modify any wallet behavior, route, service, component,
backend file, or the isolated `src/lib/xbt` signing core. Send, seed, and
recovery remain disabled and the signing core stays disconnected.

## The policy

The exact CSP string, authored in `src/frontend/index.html` as the first element
inside `<head>` and emitted verbatim into `dist/index.html`:

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://icp-api.io; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'
```

Directive rationale:

| Directive | Value | Why |
| --- | --- | --- |
| `default-src` | `'self'` | Deny-by-default for every fetch class not named below. |
| `script-src` | `'self'` | Same-origin scripts only. No `'unsafe-inline'`, no `'unsafe-eval'`, no remote origin, no `blob:`, no `data:`. |
| `style-src` | `'self' 'unsafe-inline'` | Inline CSS stays permitted so the existing design system and Radix component styling keep working. Inline script is still disallowed. |
| `img-src` | `'self' data:` | `data:` is permitted for images only, for QR rendering. |
| `font-src` | `'self'` | Fonts are self-hosted woff2 under `public/assets/fonts`; no remote font origin. |
| `connect-src` | `'self' https://icp-api.io` | Same-origin `env.json` fetch, `/api` proxy, and service worker, plus the exact cross-origin production backend API origin `https://icp-api.io`. The Internet Identity authorize origin is **not** listed because no client code performs a `fetch` to it (the identity flow is a top-level redirect, not a `connect-src` fetch). |
| `object-src` | `'none'` | Object embedding disabled. |
| `base-uri` | `'none'` | Base URI changes disabled. |
| `form-action` | `'none'` | Form submissions to any target disabled. |
| `frame-ancestors` | `'none'` | Retained as harmless and forward-compatible for a future response-header delivery. **It provides no framing protection in this meta-only revision:** browsers ignore `frame-ancestors` when the policy is delivered via a `<meta>` element; the directive only takes effect as a response header. |
| `worker-src` | `'self'` | The app registers a same-origin service worker (`/sw.js`). |
| `manifest-src` | `'self'` | The PWA manifest is same-origin. |

No remote CDN, analytics origin, or other unjustified origin is present.
`cdn.caffeine.ai` is deliberately **not** allowlisted.

## Compiled-HTML ordering evidence

Command (run from the project root):

```
pnpm --dir src/frontend build
```

Result: exit code 0. The emitted `src/frontend/dist/index.html` begins:

```html
<!DOCTYPE html>
<html lang="en" class="dark">
  <head>
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://icp-api.io; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'self'; manifest-src 'self'"
    />
    <meta charset="UTF-8" />
    ...
```

Ordering check (the CSP meta is the first head element and precedes every
`<script>`):

```
$ python3 -c "
import re
html = open('src/frontend/dist/index.html').read()
head = re.search(r'<head[^>]*>(.*?)</head>', html, re.S).group(1)
first = re.search(r'<[a-zA-Z][^>]*>', head).group(0)
print('first head element:', first[:120])
print('is CSP meta first:', bool(re.match(r'<meta\b', first)) and 'Content-Security-Policy' in first)
print('CSP index:', html.find('Content-Security-Policy'), '| first <script> index:', html.find('<script'))
"
first head element: <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'self'; script-src 'self'; style-src 'self' 
is CSP meta first: True
CSP index: 83 | first <script> index: 1827
```

The CSP meta is the first head policy element, before any script tag.

## Build-time guard

`src/frontend/vite.config.js` adds a small inline plugin
(`assert-csp-first-in-head`, `enforce: "post"`, `transformIndexHtml` with
`order: "post"`) that asserts the CSP meta is present and is the first element
inside `<head>` of the emitted `dist/index.html`, and fails the build with a
clear `[csp-guard]` error if it is missing or not first. It asserts only; it
never rewrites or reorders the policy. The existing plugins and config are
intact and no remote origin was added.

Guard logic verified against the real emitted HTML and two negative fixtures
(CSP stripped, CSP not first): the guard passes on the real output and rejects
both negative fixtures.

## Commands run and exact results

Run from the project root on 2026-09-29.

### Build — `pnpm --dir src/frontend build`

```
> @caffeine/template-frontend@0.0.0 build /home/ubuntu/workspace/app/src/frontend
> vite build && pnpm copy:env
```

Exit code 0. The guard passed. (A non-fatal Browserslist `caniuse-lite` age
notice is printed; it does not affect the build result.)

### Typecheck — `pnpm typecheck`

```
src/bridge typecheck: Done
src/frontend typecheck: Done
```

Exit code 0.

### Fix — `pnpm fix`

```
src/frontend fix$ biome check --write src
src/frontend fix: Done
```

Exit code 0. `pnpm fix` applied a cosmetic formatting change to the
tester-owned `src/frontend/src/test/csp-hardening-characterization.test.tsx`;
that change was reverted so no tester-owned file is modified by this revision.

### Frontend test suite — `pnpm --dir src/frontend test`

```
 Test Files  32 passed (32)
      Tests  227 passed (227)
   Duration  23.95s
```

Exit code 0. This includes the tester characterization suite
`src/test/csp-hardening-characterization.test.tsx` (8 tests), which passes
unchanged: no inline script body in the app shell, no remote/`blob:`/`data:`
script source, no `eval`/`new Function` in production frontend source, no remote
executable origin, self-hosted fonts, default route renders, demo send confirm
disabled with no broadcast, and no seed/mnemonic/recovery input on any route.

## App-read and network-read results under the policy

- **App reads (mock route rendering):** the default route and every declared
  route render without a blank screen under the policy (covered by the
  route-coverage and characterization suites). These suites render the routes
  with mocked services; they exercise the component tree and the policy
  invariants, **not** a live network read. No route, service, or component was
  changed.
- **Network reads (real):** the app performs no `fetch`/`XMLHttpRequest`/
  WebSocket calls other than the IC agent (to the cross-origin
  `https://icp-api.io` API origin) and the same-origin `env.json` fetch. There
  are no analytics requests and no remote executable code. QR codes render as
  inline SVG (`QRCodeSVG`), never `data:` URLs. Fonts are self-hosted woff2.
- **What the local suite does and does not prove:** the mock route-rendering
  suites prove the app shell renders and the policy invariants hold in source
  and compiled HTML. They do **not** perform a real network read and therefore
  **do not** prove live backend connectivity. Live connectivity depends on the
  deployed `backend_host` being the cross-origin `https://icp-api.io` origin
  allowed by `connect-src`; that is verified only against the deployed
  environment, not by mock rendering.
- **Browser-level enforcement:** the local test suite does **not** exercise
  browser-level CSP enforcement (see Limitations).

## Hosting response-header outcome

The project's hosting configuration surface was inspected:
`src/frontend/caffeine.toml`, `src/backend/caffeine.toml`, and the root
`caffeine.toml`. These declare only project identity, workspace inclusion,
canister dependencies, build commands, output directory, and check commands.
There is **no** supported, documented mechanism in the project configuration
surface for declaring certified response headers (no headers table, no
asset-canister response-header configuration).

Per the task instruction, no mechanism was invented and no remote origin was
added. **The in-document policy is the only policy this revision can declare
through the available configuration surface**, and it is delivered as the first
element inside `<head>`. Whether that policy is applied before the
hosting-injected analytics script executes — or whether the policy is stripped
in production — is **not verifiable from the build environment** and remains an
unresolved item requiring the operator's public-production verification (see
Limitations). This document does not claim protection that cannot be verified
from source. A certified response header could not be declared through the
available configuration surface. This is recorded as a limitation below.

## Limitations

1. **Hosting-injected analytics script.** The hosting injects
   `https://cdn.caffeine.ai/scripts/umami-script.js` into the production HEAD
   after the application script. This is automatic production-only analytics
   injection and is **not** present in source `index.html`. Whether that
   injected script would execute before the policy applies, or whether the
   policy is stripped in production, **cannot be determined from the build
   environment**. This is an unresolved item requiring the operator's
   public-production verification. This document does not claim protection
   against it. `cdn.caffeine.ai` is deliberately not allowlisted; adding it to
   silence an injection error would defeat the policy.
2. **No browser-level enforcement in the local suite.** The local test suite
   verifies source and compiled-HTML invariants only. It does not run a browser
   that enforces CSP, so it cannot prove that a browser blocks a disallowed
   resource at runtime.
3. **Backend host is a cross-origin deploy-time value.** `backend_host` in
   `env.json` is the literal string `"undefined"` in source and is injected at
   deploy time. In production the backend host is the **cross-origin**
   `https://icp-api.io` API origin, **not** same-origin `'self'`. The
   `connect-src` directive therefore lists that exact origin explicitly:
   `connect-src 'self' https://icp-api.io`. No wildcard and no other remote
   origin is present. If the deployed backend host ever changes to a different
   origin, `connect-src` must be extended with that exact host.
4. **No certified response header.** As recorded above, the available
   configuration surface does not support declaring a certified response-header
   policy, so the in-document policy is the only policy this revision can declare
   through that surface. Whether it is applied before the hosting-injected
   analytics script executes, or whether it is stripped in production, is not
   verifiable from the build environment and remains an unresolved item requiring
   the operator's public-production verification.

## References

- `FULL-WALLET-UI-GATES.md` — gate 8 (production CSP and dependency review).
- `SPENDING-DATA-VERIFICATION.md` — read-only spending-data verification.
