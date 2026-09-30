/** Public network profile and browser-reachable WSS address only. */
export const XBT_CHECKPOINT_HEIGHT = 961640n;
export const XBT_CHECKPOINT_HASH =
  "0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb";
// Same serialized checkpoint independently verified by Knots/Fulcrum and the shared bridge.
export const XBT_CHECKPOINT_HEADER =
  "000000a0657e02138733654183a2c7320d85ca9d743fe139c4bb01000000000000000000c137a8515a0f6b3aaf6049cc7611787c022ad523d51094be0a0363d0dc0bc7684dca936a4f8d001a5671798c84daeb494dca936a00000000b1ccf00d0300000000000000000000001e0300000000000000000000000000000000000068ac0e000000000000000000000000000000000000000000000000000000000000000000";
export interface WebsocketProvider {
  endpoint: string;
}
export function validateWebsocketProvider(
  raw: WebsocketProvider,
): WebsocketProvider {
  if (!raw || typeof raw.endpoint !== "string" || !raw.endpoint.trim())
    throw Error(
      "Enter your Fulcrum secure WebSocket address, starting with wss://.",
    );
  let url: URL;
  try {
    url = new URL(raw.endpoint.trim());
  } catch {
    throw Error("Enter a complete secure WebSocket address, including wss://.");
  }
  if (
    url.protocol !== "wss:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    raw.endpoint.length > 2000
  )
    throw Error(
      "Use wss:// without credentials, a query, or a fragment. A TCP/TLS port is not a WebSocket port.",
    );
  return { endpoint: url.href };
}
