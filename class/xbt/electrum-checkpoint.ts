/** First BLAKE2b block, verified from the local Knots node and Fulcrum on 2026-09-27. */
export const XBT_MAINNET_CHECKPOINT_HEIGHT = 961640;
export const XBT_MAINNET_CHECKPOINT_HASH = '0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb';

/**
 * Exact serialized 164-byte v2 header at the first BLAKE2b block.
 * The Bitcoin and XBT chains share their genesis hash, so genesis alone cannot
 * identify an Electrum server. This is a compatibility check, not server
 * authentication or proof of the current chain: a dishonest server can copy it.
 */
export const XBT_MAINNET_CHECKPOINT_HEADER =
  '000000a0657e02138733654183a2c7320d85ca9d743fe139c4bb01000000000000000000c137a8515a0f6b3aaf6049cc7611787c022ad523d51094be0a0363d0dc0bc7684dca936a4f8d001a5671798c84daeb494dca936a00000000b1ccf00d0300000000000000000000001e0300000000000000000000000000000000000068ac0e000000000000000000000000000000000000000000000000000000000000000000';

export function isXbtMainnetCheckpointHeader(headerHex: string): boolean {
  return typeof headerHex === 'string' && headerHex.toLowerCase() === XBT_MAINNET_CHECKPOINT_HEADER;
}
