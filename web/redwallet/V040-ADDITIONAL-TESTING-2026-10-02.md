# RedWallet 0.40 additional testing — 2026-10-02

Public release remains0.40/Caffeine43. Source clean at736a4e574; clean CI36976094899
also passed. No runtime changes were made for this test session.

Roman Knowledge search for RedWallet0.40recovery scan returned no records.
Live public disposable fixture only: PUBLIC0.40TEST—NEVERFUND. Its9saved addresses
survived several hours paused, and Resume advanced without resetting the counter.
The live encryption/XBT signing self-test passed; no transaction was broadcast.
Wrong dummy password was rejected, then the correct dummy password decrypted the
same saved fixture. Cancelling a separate unfinished recovery form cleared its
phrase entry; the three existing encrypted fixture wallets remained listed.

Direct home WSS Test connection passed at XBT block975151 using
wss://umbrel-3.tailaa2bb4.ts.net:10000/fulcrum-ws. The test was draft-only; the active
built-in service was preserved. Draft selection was returned to built-in afterward.

Targeted lifecycle/inventory regression rerun:19tests in2files PASS (14recovery
form,5catalog). Includes the exact30second expiry boundary, both clocks and
suspended timers, pending encryption cancellation, and independent vault removal.
Cloud browser tabs remain document-visible, so this session cannot independently
reproduce actual iPhone app suspension. A real iPhone switch remains user testing.

The scan finished successfully at41addresses, block975151, zero confirmed and
pending balance, and no history within the bounds. Full reload and correct fixture
unlock restored41addresses immediately, Refresh account was available, Resume scan
was absent, and the original observation timestamp remained exactly unchanged
(2026-10-01 23:55:57 browser-local display). No new scan was started after reload.
Fixture keys were explicitly locked after testing. Screenshot:
redwallet-040-completed-scan.jpg. No new failures were found; no runtime update needed.
