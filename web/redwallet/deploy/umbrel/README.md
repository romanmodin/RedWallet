# Umbrel deployment

The bridge runs on host loopback port 8090 and reads the local Fulcrum on
127.0.0.1:55001. It has no wallet/node data mounts. TLS terminates at the
dedicated HTTPS ingress. Existing Umbrel, mining, and private Serve routes
are independent of this service.

Installation directory: `/home/umbrel/redwallet-bridge`. Source checkout:
`repository/web/redwallet`. Run Compose with `--project-directory` set to the
installation directory and this `compose.yaml` passed with `-f`.

Keep `.env` outside the repository with mode 600. Set a random `BRIDGE_SECRET`
of at least 32 bytes, `CHECKPOINT_HEIGHT`, `CHECKPOINT_HEADER_HEX`, and
`CHECKPOINT_HASH`. Validate the checkpoint against the live XBT node before
first deployment. No deployment secret belongs in project source.

The verified checkpoint on 2026-09-29 was height 961640, hash
`0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb`.
Knots and Fulcrum returned identical extended header bytes. The bridge pins
those exact bytes; it does not assume an 80-byte BTC header or substitute a
BTC hash algorithm.

The dedicated operator identity is stored privately in
`operator/operator-identity.json`. Only its public principal is included in
the canister source. Run `configure-canister.mjs` from that directory with the
deployed canister ID and HTTPS bridge base URL. The script reads the secret
locally and sends it only in the authenticated canister configuration call.

Before publishing, verify container health, authorization rejection, real
status with a verified checkpoint, address balance/history, and failure
responses. Then verify the HTTPS endpoint externally and through an actual
canister outcall. Local health alone does not prove ICP reachability.

To stop the bridge, run `docker compose stop` with the same project directory
and compose path. Disable only its dedicated ingress when retiring it.
