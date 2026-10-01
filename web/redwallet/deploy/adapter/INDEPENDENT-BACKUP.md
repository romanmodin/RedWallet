# Independent shared-service backup

The current HTTPS bridge and direct WSS endpoint both use the home Umbrel.
Neither is an independent backup. The 0.34 source now registers the public
mempool.guide WSS service after that primary, with live checkpoint, browser
worker, wallet-read and simulated-primary-outage verification. Publication
status is in V034-MEMPOOL-BACKUP-2026-10-01.md. The home primary stayed online.
No funded backup transaction or actual home outage was used for verification.
The steps below apply when adding another operator-hosted service.

## Host information needed

| Item | Required information |
| --- | --- |
| Independent host | An always-on machine outside the home's power and internet connection, with operator access |
| XBT node and index | Its own synced XBT-compatible node and Fulcrum, with capacity for their chain data and index |
| Public service | A reachable HTTPS hostname with a trusted certificate |
| ICP adapter | Required for an HTTPS bridge; native WSS uses no extra canister |

Use `src/bridge/Dockerfile` and the existing protected environment workflow in
`deploy/umbrel/README.md`. Follow `deploy/adapter/README.md` for checkpoint,
credential, TLS, provider identity and canister configuration. Credentials stay
on the operator's host; never include them in a frontend archive or prompt.
A canister pointing to the existing home bridge does not satisfy independence.

## Acceptance before registration

1. Verify the exact XBT checkpoint header at 961640, its pinned hash, a recent
   header-derived tip, and a height no more than six blocks behind the last
   healthy primary observation.
2. Check balance, history, UTXO, fee and raw-transaction routes using public
   fixtures. Check unauthorized requests and invalid signed submissions are
   rejected. Keep broadcasting disabled until the operator deliberately enables
   the existing broadcast gate; do not submit a funded transaction for this test.
3. Check the new canister's public provider information against its actual HTTPS
   base URL and Fulcrum host/port/TLS. Check both upstream and canister failures
   remain visible, with no credential disclosure.
4. Test primary-unavailable routing with an isolated test configuration. Confirm
   backup identity is displayed, stale results and payment reviews are discarded,
   historical wallet data remains saved, and no automatic broadcast retry occurs.
   Keep the working public primary online during these checks.
5. Record the verified canister ID, name, exact HTTPS base URL, source revision,
   checkpoint, tip and test results. Only then add the entry to `BUILTIN_BACKUPS`,
   run the provider tests, publish and verify the actual public release.

No independent operator-owned host was found in the saved infrastructure notes
on 2026-10-01. The public mempool.guide service avoids needing a second full
node of our own. Its hosting, capacity and availability remain controlled by
that operator; the protocol checks do not establish a service guarantee.
Creating another canister alone would leave the home-node dependency unchanged.
