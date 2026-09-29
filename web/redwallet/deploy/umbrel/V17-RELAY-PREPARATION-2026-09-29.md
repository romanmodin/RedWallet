# RedWallet signed relay preparation — 2026-09-29

The v16 production encrypted-account browser verification is complete. The
public BIP84 fixture (clearly labelled never deposit) completed an82-address
scan at block974748, with confirmed/pending0 and real transaction history.
Locking keys did not interrupt public reads. Pause retained17 checked addresses,
and resume completed the scan. Receive index41 was durably reserved and the
browser clipboard readback matched its displayed address. No funds moved.

## Scope

The imported v17 backend adds `broadcastSignedTransaction(raw, expectedTxid)`
and optional `ServerStatus.broadcastEnabled`. No private material enters this
API. The existing quotas, operator configuration, CSP and frontend wallet
controls remain. Exported v17 source matched all271 imported files except the
three expected regenerated frontend binding files.

The bridge now contains a narrow `transaction.broadcast` route. It requires
existing bearer authentication, an operator-configured checkpoint and explicit
`ENABLE_BROADCAST=true`. Default and live setting remain false. The exact
version2/P2WPKH/Unified0x21 signed format is bounded and validated. Success means
only an exact txid acknowledgment. Lost replies and upstream errors are unknown,
not proof of rejection. Identical requests coalesce; retries within ten minutes
reconcile raw bytes without rebroadcast. After that window, the SAME original
bytes can be explicitly resubmitted. No replacement transaction is synthesized.
For future activation with100inputs, set MAX_REQUEST_BYTES=65536 privately;
current read-only deployment retains its existing smaller limit.

The isolated frontend PendingPayments module revalidates every saved Unified
signature, input ownership, signed values and displayed outputs. It reserves
one unresolved payment per account with cross-tab Web Locks; a successful durable
write/readback is mandatory before a caller may submit. Local state labels never
permit a new payment. No release/archive or submission UI is mounted yet.
SpendPreparation performs paced checkpoint/fee/UTXO/raw-parent reads, reserves
change, and produces the immutable60-second SpendReview. Both modules remain
unmounted. They do not make the deployed app a spending wallet.

## Verification

- Bridge79tests pass, including HTTP auth/default-off/checkpoint ordering and
  exact signed-regtest fixture relay to a MOCK upstream only.
- Local frontend48files/296tests pass; TypeScript and production build pass.
- Caffeine verification reports Motoko15passed, PocketIC14passed, neither skipped
  in completed runs. An earlier missing-wasm skip was resolved with mops build.
  PocketIC covers malformed submission/unconfigured/auth APIs, not successful
  real HTTPS outcalls. Pure Motoko tests cover successful response parsers.
- Draft canister uxwok-mqaaa-aaaad-qi6ua-cai at21:28:08Z returned checkpoint
  verified, height974750, broadcastEnabled=false; malformed signed input rejected.
- Anonymous production read probe at21:22:48Z passed balance/history/fees/UTXO/raw
  and exact XBT checkpoint, height974749, history176, raw175bytes, fees1000sat/kB.

## Umbrel deployment

Image sha256:76d4beae2dadc4e99e5559a7eb462c5fed3d8799b9abb555958e946e1cbefd8e
is running healthy; loopback health200, unauthenticated RPC401, authenticated
status checkpoint verified / height974750 / broadcastEnabled=false.
Archive SHA256 b86d4bf3182c6472bcd2e099e9a0632154301fe00b1a86278fd4967ec60999f8.
Rollback source: backups/bridge-before-broadcast-20260929T212702Z.tar.gz.
Rollback image: redwallet-fulcrum-bridge:before-broadcast-20260929t212702z.
No credentials, ingress or native worktrees changed. Existing8443/8444,443 and
mining22573 were untouched. Production canister is7gylz-gyaaa-aaaab-qhjrq-cai.
Publication and post-upgrade evidence are recorded separately below when verified.

Caffeine confirmed: "Version17 is now live and serving users!"
The v17 bridgeService formatting is normalized to the frontend Biome config
in Git (format-only difference from the deployed import). Frontend lint179files
passes. The two isolated new client modules and this note are Git preparations,
not part of the imported v17 archive.
