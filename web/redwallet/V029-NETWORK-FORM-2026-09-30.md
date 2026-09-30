# RedWallet Web 0.29 — required bridge URL clarity

User's iPhone screenshot showed a valid home Fulcrum host/port/TLS alongside an
empty endpoint displaying the home URL only as placeholder text. Test and Save
surfaced Safari's raw `"" cannot be parsed as a URL` exception. The active built-in
connection was unaffected, but the placeholder looked like a configured value.

The custom form now uses an explicit entry prompt, marks the URL required,
explains that example text is not saved and that built-in needs no custom fields.
Draft settings are clearly distinguished from the currently active service.
Empty/whitespace and malformed URLs return fixed, helpful messages before any
adapter call; surrounding paste whitespace is accepted. HTTPS/credential/query/
fragment restrictions and tested Save are preserved. No automatic endpoint or
provider substitution was added. Browser URL input disables capitalization and
spelling correction. All wallet data, routes, keys, signing, CSP, NeoxEX work,
backend and native worktrees remain unchanged.

User-facing version 0.29 is the next frontend release. Backend source is exactly
the 0.28 backend whose published artifact passed 25 PocketIC tests on Zorin.
Compilation, exact-source export comparison, publication and live form checks
will be recorded after completion; this document does not claim publication.
