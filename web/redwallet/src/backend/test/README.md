# Standalone Motoko contract tests

Use the native compiler pinned in `mops.toml`, not the JavaScript Motoko
interpreter. The large malformed-response fixtures can overflow the latter.
These tests use public dummy data and make no live network requests.

From `web/redwallet`, with Mops available:

```sh
mops install --locked
mops test bridge --locked --mode interpreter --reporter verbose
```

`bridge` is a filename filter; passing the full source path as the filter finds
no tests in Mops 3.4.1. Treat zero discovered tests as an unsuccessful check.
The suite lives in `src/backend/test/bridge.test.mo` and includes the 1001-UTXO
rejection and oversized raw-transaction fixtures; do not exclude them.

For an isolated workstation run, copy `mops.toml`, `mops.lock`, and the backend
`lib`, `types`, and `test` directories with their paths intact into a temporary
project. Run the commands there. Compare source bytes before recording results;
keep tool downloads, replica state and generated binaries outside Git.

WASI mode currently fails to compile the implicit core package's async Random
APIs under moc 1.16.0. This is a test-runtime limitation, not a successful test
or a reason to change production compiler flags. The native interpreter and
the separate compiled-backend PocketIC lane cover different execution paths.
