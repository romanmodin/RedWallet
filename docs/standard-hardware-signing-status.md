# Standard hardware signing: draft, release blocked

Native SegWit watch-only standard SIGHASH_ALL (0x01) preparation, full funding transactions, preserved origins, exact reviewed-transaction/signature validation and broadcast-time separation checks are implemented. Unified remains the default. No private key is imported.

`STANDARD_HARDWARE_RELEASE_ENABLED` remains false. The setting is hidden and runtime guards reject activation, proof preparation, result authorization and broadcast. Tests bypass that guard only for the candidate path. This is not a TestFlight release or a physical Keystone signing result.

## Separation evidence and trust

Unified funding alone is insufficient: different SegWit signatures can share one transaction ID. The candidate requires direct Unified P2WPKH funding with six XBT confirmations, plus a *different* confirmed SHA-256 transaction spending one of that funding transaction's inputs. Thus the funding body cannot coexist on the checked SHA-256 chain.

The app retrieves outspend evidence, raw transactions, Merkle branches and headers from Blockstream. It cross-checks the fork checkpoint, current heights, conflict block hashes and block transaction counts against mempool.space. It hashes the transaction/header locally, checks the exact conflicting outpoint, validates Merkle inclusion with anchored depth/position/count, permits only legitimate odd-level duplication, and requires six confirmations. Each selected funding transaction must qualify. Absence, missing evidence, malformed responses, disagreement and outages all block.

**Trust model:** this relies on two independently operated HTTPS explorer chain views. It is not local consensus/header-chain validation and does not protect against both sources supplying an agreed false view or a later sufficiently deep reorg. The UI confirmation and review disclose this. No SHA-256 wallet session is selected or connected. The explicitly enabled mode would send public funding-ancestor transaction IDs to Blockstream and block lookups to both providers, revealing IP/request timing. It sends no xpubs, seed, PSBT or payment destinations to these services. Requests use GET only, with deadlines, count and accepted body-size limits.

Evidence is freshly collected before request creation and again before XBT broadcast. Block hashes are re-read at the end of collection. Authorization is checked throughout requests and after asynchronous work. Review/mode changes invalidate the request. A slow hardware review does not expire a valid returned signature; pre-broadcast verification must still succeed.

## Scope and remaining qualification

- Coin selection runs once; only selected inputs undergo separation verification. Existing base-wallet UTXO integrity/maturity checks remain intact.
- Initial support is direct Unified P2WPKH funding. Descendants (including standard-send change), coinbase, mixed/Taproot funding and RBF remain unsupported and block if selected. No automatic coin splitting is performed.
- Physical Keystone 3.0.2 signing, the native mobile socket implementation/UI and independent review remain release requirements. Production BlueElectrum with real Node TLS sockets and Fulcrum now passes alongside isolated Knots acceptance/replay qualification (details below).
- Umbrel Docker inspection was unavailable without sudo authentication; no node settings or funds were changed.

## Validation

The focused suite covers proof integrity, independent-source disagreement, reorgs, malformed/insufficient evidence, cancellation, exact selected inputs, delayed signing, mode changes, existing XBT Unified signing and BTC hardware signing. TypeScript and changed-file ESLint are checked.

A read-only live public-chain exercise passed on November 13 Pacific (November 14 UTC), using a real confirmed SHA-256 transaction and a hypothetical conflicting funding body. This verifies live transport and proof inclusion only, **not XBT transaction validity, actual wallet separation or hardware acceptance**. Receipt: `docs/evidence/standard-hardware-public-proof-20261113.json`. Reproduction: `node scripts/diagnostics/check-separation-service.cjs` from repository root with dependencies installed. No keys/signing/broadcast calls exist in that diagnostic.

### Shared-history node qualification

The opt-in integration test starts independently verified Bitcoin Core 29.0 and Knots 29.4.2 binaries in new temporary regtest directories, with loopback RPC and no peers. Both nodes share the exact chain and funding outpoint through height 149. Knots activates BLAKE2b at 150. Published test-seed coins only are used.

It demonstrates that the Unified parent is accepted by Knots and rejected by Core, while a freshly signed standard variant with the same transaction ID can be accepted by Core before a conflicting spend. Simply changing the standard signature flag to 0x21 is rejected by Knots. The wallet blocks standard signing until a different conflicting Core spend confirms. After six confirmations, the production watch-only builder preserves fingerprint/path, exports a standard request, accepts the simulated cold signer's URv2 return, and rejects changed signed amounts. Knots accepts and confirms the resulting transaction; Core rejects both that transaction and the alternative parent after the conflict. An actual Core reorg removing the conflict also causes the production separation recheck to block.

The explorer adapter maps requests to the isolated Core node and translates regtest heights to exercise unchanged mainnet thresholds. This does not qualify independent public explorer chain views, public explorer TLS, native mobile sockets/UI, or a physical Keystone. The Electrum side now uses a real authenticated Node TLS connection and actual Fulcrum indexer, with only checkpoint/height presentation adapted. The separately recorded public-chain diagnostic covers live explorer transport. Runtime release remains disabled.

Reproduction: set `REDWALLET_BTC_REGTEST_BITCOIND`, `REDWALLET_XBT_REGTEST_BITCOIND` and `REDWALLET_XBT_REGTEST_FULCRUM` to verified test binaries, then run `node_modules/.bin/jest --runInBand tests/integration/xbt-standard-hardware-regtest.test.ts`. A successful run writes `artifacts/standard-hardware-regtest/receipt.json` after both nodes stop and temporary data is removed. CI downloads checksum-pinned binaries and runs the same test.

The proof-service request budget now scales with the bounded funding-input count instead of a fixed 128 requests. Regression cases cover 13 and 64 distinct funding parents and a conflict found only after scanning 64 candidate inputs. Deadlines and body-size limits remain. HTTP cache-control headers replace the unsupported React Native `RequestInit.cache` option that failed the previous CI type check.

Earlier RPC-adapter node receipt: `docs/evidence/standard-hardware-regtest-20261114.json`, tested source `37eed460234dfb1d571e9ef79aa3ba21981e214a`. Final local validation: 83 focused tests plus the real-node scenario, TypeScript no-emit, changed-file ESLint and diff checks passed.

### Broadcast boundary regression qualification

The production wallet and BlueElectrum broadcast functions are now exercised together with mocked Electrum client and HTTPS edges. Fourteen new regression cases cover fresh XBT confirmation checks, unavailable/malformed/insufficient tips, public-proof outages after signing, signer enrollment changes, connection replacement, altered signed bytes, unexpected returned transaction IDs, slow hardware review, concurrent submissions and explicit retries.

These tests initially exposed two submission defects: a failed fresh-tip request could reuse a cached mature height, and a reconnect during proof collection could switch the broadcast client. Spend authorization now requires a successful fresh tip and binds all proof reads and submission to the same client/disconnect generation. Display-only callers retain their existing cached-tip behavior. A per-wallet in-flight guard prevents concurrent duplicate submissions; a failed submission may be retried explicitly, with fresh evidence checks.

Local validation on November 14, 2026: 146 focused tests in seven suites, the isolated shared-history Core/Knots scenario, TypeScript no-emit, changed-file ESLint and diff checks passed. The new boundary tests use synthetic public fixtures and mocked transport edges; they do not qualify real Electrum sockets, a physical Keystone or native UI. Runtime release remains disabled.

### Real Electrum socket qualification

The shared-history test now removes all BlueElectrum reader mocks and starts checksum-pinned Fulcrum 2.1.3-blake against the disposable Knots node. The production Electrum client and BlueElectrum functions connect through authenticated Node TLS. The loopback TLS adapter substitutes the fixed mainnet checkpoint and offsets low regtest heights; funding/history data comes from Fulcrum, and raw transaction bytes are forwarded unchanged.

The test rejects an untrusted certificate before any wallet query, then connects with the fixture CA. The real Core reorg blocks submission at the production wallet broadcast boundary. An explicit tip RPC error also blocks despite a prior mature tip. Replacing the real TLS connection during public-proof work blocks both old/new connections from submitting; an explicit retry then submits exactly the reviewed bytes once. Knots confirms that transaction, Core rejects it, and a repeated approved-send attempt is blocked.

The receipt records actual protocol method counts, source and installed client hashes, node/indexer binary hashes, connection/broadcast counts and cleanup. CI requires these outcomes and downloads the manifest-pinned Fulcrum binary. The first test attempts needed two harness corrections: Electrum rejects with a JSON-RPC error object rather than an Error instance, and the reconnect probe must await the new connection after the original verification rejects. Neither required changing production signing code.

This qualifies Node TLS sockets through the production JavaScript transport. It does not qualify React Native's socket implementation, device approval/screens, public explorer independence, or a physical Keystone. The release switch remains false.

Socket/consensus receipt: `docs/evidence/standard-hardware-electrum-20261114.json`, clean tested source `445a4501ac0f0bb6b778a920c5bd72945ac457b7`. It records two authenticated connections, seven header requests, twelve transaction reads, six history requests and exactly one broadcast. TypeScript, changed-file ESLint and workflow YAML/wiring checks passed.

### Native iOS qualification added (not yet passed)

A dedicated simulator-only workflow now builds the watch-only signing screens with an explicit CI source overlay. The checked-in release switch remains false. The overlay only enables the staged mode and redirects the two explorer base URLs to a loopback HTTPS fixture. It records source/overlay hashes, labels the app **RedWallet TEST ONLY**, and publishes a uniquely named simulator artifact that is not consumed by ordinary app build/release jobs.

The new native case imports a public BIP84 account without importing its seed, checks cancellation and persistence of signer enrollment, prepares the send through the real UI, copies the PSBT through the iOS clipboard, and returns a host-simulated cold signature through the existing scanner test input. It requires missing proof to block preparation, an actual Core reorg to block the signed transaction, and an explicit retry to broadcast the unchanged bytes exactly once through native TLS/Fulcrum. Knots confirmation and Core replay rejection are checked afterwards.

The isolated shared-chain fixture uses real Core, Knots and Fulcrum with a private test CA. Its separate Linux qualification passed: untrusted HTTPS is rejected; missing/disagreeing/unavailable evidence and a real reorg block proof. It now discovers the public watch-only account through production wallet balance/history/UTXO calls, enables signing after discovery, prepares the PSBT, combines the simulated signature, and broadcasts through the production wallet and authenticated Electrum connection. Knots confirms the result and Core rejects it. The production Node TLS integration also passed after extracting the shared node helper. Pinned Core macOS assets are included for simulator runners.

Native iOS completion is pending the dedicated CI run. These tests do not qualify physical Keystone, camera optics or independent public explorer operation. Stock-hardware mode remains disabled in release builds.

First dedicated iOS attempt: run 43562756681 built the simulator app and test backend successfully, but the Detox host failed while importing the ESM @noble/secp256k1 dependency. No app flow or hardware signing was exercised. The native Jest transform now includes @noble packages, and a preflight under the same module configuration runs before simulator build/setup. The preflight reproduces the failure with the original configuration and passes with the correction. Native completion remains pending the rerun.

Second dedicated iOS attempt: run 43565260570 passed the new host preflight, built the simulator app/backend, and launched the app. It stopped in server setup because iOS does not expose the host field's React Native test ID. No account import, signing or broadcast was reached. The native setup now uses the established native text-field/value selector, scrolls the field into view, dismisses its keyboard and waits for the saved-connection alert transition.

Gitar review discussion 4571749356 identified that a failed fixture shutdown could skip the evidence receipt and hide the original test failure. The qualification wrapper now independently attempts test, cleanup and receipt writing, records both failures, marks cleanup failures unsuccessful, and preserves the original test exception. Nine regression cases passed, including a real failed receipt written to disk. These changes do not enable the release switch or establish native signing success; the next simulator run is still required.

### Native preparation failure reproduced with mobile Buffer

Run [43569625656](https://github.com/romanmodin/RedWallet/actions/runs/43569625656) passed native TLS setup, public watch-only import and balance discovery, enrollment cancellation/persistence, and missing-proof rejection. With valid proof, the app displayed “Argument must be a Buffer” before exporting a PSBT. Its receipt records missingProofBlocked=true, passed=false and cleanupComplete=true; no signing/broadcast qualification passed.

The error was reproduced locally with the actual mobile Buffer package: bitcoinjs parses input hashes as Uint8Array, but the mobile Buffer.equals implementation requires a Buffer argument. The exact-outpoint comparison now converts both hashes to Buffer. The new regression test fails on the previous code with the same error, accepts the valid proof after correction, and still rejects an unrelated hash with the same output index.

The PSBT screen now stacks the standard-signing disclosure above the QR/actions rather than placing two cards in one horizontal row. A missing native identifier was added to the existing read-only signed-transaction field so the native test can inspect the returned bytes. The simulator test explicitly checks the disclosure and scrolls to the PSBT controls. The release flag remains false; a new simulator run and physical Keystone qualification are still required.

Validation for the mobile Buffer correction: 90 tests in eight suites passed, including both real isolated Core/Knots/Fulcrum integration scenarios and the mobile Buffer regression. TypeScript no-emit, changed-file ESLint and diff checks passed. This does not substitute for the pending native simulator rerun or physical device test.

### November 14 alert transition retry

Native run 43584902289 built successfully but stopped after cancelling the standard-signing opt-in: Detox reported that a UITransitionView intercepted the next switch tap. Its failure screenshot shows the underlying switch visible and still off. The scenario did not reach PSBT creation, so it neither verifies nor disproves the mobile Buffer fix.

The test now retries only Detox's specific pre-touch UITransitionView hit-test rejection, with a bounded wait. Successful taps and ambiguous errors are never retried; cancellation and persistence assertions remain. Five helper regression cases cover successful retry, unrelated failures and bounded obstruction. Gitar's six code findings are closed and its code review is approved; native simulator and physical Keystone qualification remain release gates.
