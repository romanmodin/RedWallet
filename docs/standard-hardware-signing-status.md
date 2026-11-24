# Standard hardware signing: draft, release blocked

Native SegWit watch-only standard SIGHASH_ALL (0x01) preparation, full funding transactions, preserved origins, exact reviewed-transaction/signature validation and broadcast-time separation checks are implemented. Unified remains the default. No private key is imported.

The proposed iPhone build offers Keystone mode for an XBT Native SegWit watch-only account after explicit confirmation. The user identifies the signer as a Keystone. Public account descriptors do not attest its manufacturer. Unified remains the default. Other platforms retain the closed release gate. The simulator uses the same platform gate as the release build. Internal distribution requires qualification of this revision.

## Separation evidence and trust

Unified funding alone is insufficient: different SegWit signatures can share one transaction ID. The candidate requires each selected Native SegWit output to trace through verified standard (0x01) transactions to Unified P2WPKH roots. Every selected, intermediate and root transaction needs six XBT confirmations. Each root also needs a *different* confirmed SHA-256 transaction spending one of that root transaction's inputs. Thus the funding body cannot coexist on the checked SHA-256 chain.

The app retrieves outspend evidence, raw transactions, Merkle branches and headers from Blockstream. It cross-checks the fork checkpoint, current heights, conflict block hashes and block transaction counts against mempool.space. It hashes the transaction/header locally, checks the exact conflicting outpoint, validates Merkle inclusion with anchored depth/position/count, permits only legitimate odd-level duplication, and requires six confirmations. Every input branch of a standard ancestor must qualify; shared roots are deduplicated only after checking each exact outpoint. Absence, missing evidence, malformed responses, disagreement and outages all block.

**Trust model:** this relies on two independently operated HTTPS explorer chain views. It is not local consensus/header-chain validation and does not protect against both sources supplying an agreed false view or a later sufficiently deep reorg. The UI confirmation and review disclose this. No SHA-256 wallet session is selected or connected. The explicitly enabled mode would send public funding-ancestor transaction IDs to Blockstream and block lookups to both providers, revealing IP/request timing. It sends no xpubs, seed, PSBT or payment destinations to these services. Requests use GET only, with deadlines, count and accepted body-size limits.

Evidence is freshly collected before request creation and again before XBT broadcast. Block hashes are re-read at the end of collection. Authorization is checked throughout requests and after asynchronous work. Review/mode changes invalidate the request. A slow hardware review does not expire a valid returned signature; pre-broadcast verification must still succeed.

## Scope and remaining qualification

- Coin selection runs once; only selected inputs undergo separation verification. Existing base-wallet UTXO integrity/maturity checks remain intact.
- Native SegWit standard descendants, including change, are supported through bounded ancestry: at most 64 selected inputs, 64 standard edges per path, 64 distinct Unified roots, 256 fetched transactions and 16,000,000 aggregate raw-transaction hex characters. All branches must qualify. Coinbase within the selected-to-root path, mixed signature modes, non-P2WPKH ancestry and RBF remain unsupported. Root input prevouts may predate activation. No automatic coin splitting is performed.
- Physical Keystone and OneKey signing/camera/file interoperability remain release requirements. The baseline native iOS simulator passed at e699d813; this ancestry follow-up needs its own exact-source simulator qualification. Production BlueElectrum with real Node TLS sockets and Fulcrum passes the extended change-spend scenario described below.
- Production HTTPS redirect/privacy behavior also needs native qualification: React Native fetch does not reliably enforce redirect rejection. The release gate stays false; no live node settings or funds were changed.

## Native proof transport follow-up — November 16, 2026

React Native fetch cannot be relied upon to enforce `redirect: error` before a follow-up request. The new iOS adapter therefore uses a dedicated URLSession transport compiled directly into the app, independent of LND and without changing dependency locks. Its only operations are restricted evidence GET and cancellation. Exact canonical provider/route allowlists, normal system TLS verification, no redirects or HTTP authentication, no cookies/credentials/cache stores, per-route streaming byte limits, four admitted requests and absolute eight-second deadlines are enforced natively. Completion/cancellation/invalidation share an atomic settlement path. Deadline checks repeat before returning success; entering the background cancels pending requests, and registration requires an active app.

The JavaScript mobile adapter never falls back to generic fetch when native support is absent. Actual Metro builds for iOS and Android both selected the `.native.ts` adapter and excluded the Node fetch adapter. Android standard compatibility remains unsupported and fails closed; existing Unified/SHA256 paths are unaffected. Node diagnostics and host tests explicitly use the Node adapter. Bundle receipt: `docs/evidence/standard-hardware-mobile-proof-bundles-20261116.json` (honest working-tree source hashes, not a clean-commit release receipt).

Validation so far: 87 affected JavaScript policy/adapter/proof/broadcast tests, TypeScript, changed-file lint, both isolated Core/Knots/Fulcrum integration scenarios, native host module preflight and both platform bundles pass. Native Swift transport tests and app build are added but have not run on this Linux host. The simulator flow now requires actual local TLS redirect responses to produce zero requests to a disclosure-probe route, blocks oversized chunked responses and silent responses, then completes the existing signing/reorg/broadcast flow. Those native results remain pending; unit delegate tests alone do not establish TLS non-follow.

The simulator overlay rewrites both JavaScript and native base constants only for its guarded CI build, records all transport/bridge/project source hashes, and checks them again after compiling. It retains the TEST ONLY label and separate artifact. No production activation, merge, physical-device qualification or real funds are involved. Normal trust respects user-installed system roots and network/VPN policy; no pinning or proxy override was introduced. The two providers still learn public queried transaction IDs and timing. Physical Keystone/OneKey and native qualification remain required.

## Current qualification — November 16, 2026

The direct-funding baseline at `e699d8138150b31b113a1b86dd2cf03b58b588d3` passed [native simulator run 43673154651](https://github.com/romanmodin/RedWallet/actions/runs/43673154651). Its artifact digest was independently checked against GitHub: `a89c5625b39ecf83c7bd1e4da6f5fd710b0ae0867b9215cc85b12418c5d77bd7`. The receipt records a clipboard PSBT round trip, missing-proof and actual SHA256 reorg rejection, exactly one native TLS submission, two XBT confirmations, Core replay rejection, and successful cleanup. Receipt: `docs/evidence/standard-hardware-native-e699-20261115.json`. This used a host signer with a public test seed and scanner text injection; it is not physical hardware or camera qualification. Historical failure notes below precede this passing run.

This follow-up permits spending confirmed standard-send change by validating the entire bounded ancestor graph afresh before preparation and broadcast. It verifies every fetched transaction ID, actual previous output value/script, full signature and signature mode; rejects inflationary totals; checks each selected/intermediate/root history; and sends only deduplicated verified roots to the existing conflict-proof service. A cached shared ancestor retains its remaining depth so a longer path cannot bypass the depth limit. Only immediate funding transactions enter the PSBT. No persistent ancestry authorization is stored.

Local validation passed: 125 tests in seven focused unit suites, TypeScript no-emit, changed-file ESLint, and two isolated Core/Knots/Fulcrum integration scenarios. The extended scenario prepares and signs a second standard payment from the first payment's six-confirmed change, blocks submission after either an XBT intermediate reorg or a SHA256 root-conflict reorg, restores those chains, and submits exactly once after explicit retry. Knots confirms it twice; Core rejects it with missing inputs. Both payments' exact signed bytes are observed at the production Electrum broadcast boundary, and repeated submission is blocked. All disposable processes/data are cleaned up.

Receipt: `docs/evidence/standard-hardware-change-regtest-20261116.json`. This local receipt honestly records the baseline HEAD with tracked follow-up changes and hashes of the tested sources; it is not a clean-commit CI receipt. Every recorded source hash matched the files before this commit. CI requires both change-reorg outcomes, rejection on Core, six parent confirmations, two final confirmations and exactly two distinct total broadcasts (one per approved test payment).

The existing GET-only public proof diagnostic passed again at 2026-11-16T10:34:20Z: `docs/evidence/standard-hardware-public-proof-20261116.json`. It uses a real public SHA256 conflict and a hypothetical competing body, so it demonstrates live evidence transport/inclusion only. No wallet addresses, keys or payments are used.

Gitar reviewed the ancestry design on PR245; review of this exact follow-up diff and its new native simulator run remain pending. The test-only workflow permits this specific follow-up branch; production gates and signing/release workflows are unchanged. Physical Keystone first, then OneKey, must validate the actual exported/imported PSBT, device review and camera/file transport before release. Any real-money test requires separate explicit authorization. Standard mode remains disabled in production.

## Historical validation

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

### Native iOS qualification added (historical attempts before e699d813)

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

### November 14 Merkle-root byte-view correction

Native run 43588265357 passed enrollment cancellation/persistence and missing-proof rejection, then displayed “Argument must be a Buffer” during valid-proof preparation. Its receipt records missingProofBlocked=true, passed=false and cleanupComplete=true. No PSBT round trip or broadcast completed.

The remaining Merkle-root comparison now normalizes the header slice to Buffer before calling equals. A regression forces the mobile Buffer package's typed-array views to return Uint8Array: the previous comparison reproduces that exact error, while the corrected comparison accepts the valid proof and rejects an incorrect root. The standard-request preparation/signature-combination test also exercises this byte-view behavior. This is a local reproduction, not a direct Hermes execution.

The release switch remains false. A fresh native simulator run and physical Keystone qualification are still required.

Validation: 91 tests in eight suites passed, including both isolated Core/Knots/Fulcrum integration scenarios. TypeScript no-emit, changed-file ESLint and diff checks passed.

### November 14 native PSBT preparation and export control

Run 43592270176 passed the prior Buffer failure and displayed the unsigned PSBT QR with the standard-signing notice. It then stopped because the CopyUnsignedPsbtButton could not become visible after scrolling; the failure screenshot shows QR, scan/open and file-export controls, but no visible Copy action. The clipboard/signature/broadcast assertions have not passed.

Copy unsigned PSBT is now a full-size themed action immediately below the explanation and above the QR. It copies the same Base64 PSBT through the existing native clipboard API, with haptic feedback. It no longer depends on reaching a small text link beneath all QR controls. The native test still requires actual button visibility and reads the clipboard to parse the request. The release flag remains false and a fresh simulator run is required.

Gitar approved the 70ab5f0 code review with six findings closed and none open. The ordinary iOS UI/TLS workflow passed. Separate Android window-focus and LND estimate-changed failures remain under triage; neither is treated as a passing qualification.

### November 14 clipboard round trip and scanner readiness

Run [43609471430, attempt 2](https://github.com/romanmodin/RedWallet/actions/runs/43609471430/attempts/2) on source 7333e1e passed native TLS setup, public watch-only discovery, enrollment cancellation/persistence and missing-proof rejection. The actual Copy action produced a parseable unsigned PSBT in the iOS clipboard, with public fixture fingerprint 73c5da0a and SIGHASH_ALL (1). The host fixture successfully signed that request.

The next step failed because Detox could not find ScanQrBackdoorButton immediately after opening the scanner. The failure screenshot shows the scanner open; the test had no readiness wait while automatic synchronization was disabled. It now waits for the existing scanner test-input control before tapping. No application signing or proof check was changed.

Receipt: missingProofBlocked=true, clipboardRoundTrip=true, passed=false, cleanupComplete=true. Returning the signature through the app, native broadcast-time reorg rejection and native broadcast/confirmation remain unqualified. A fresh native run is required. Physical Keystone and camera scanning remain untested, and the production release switch remains false.
