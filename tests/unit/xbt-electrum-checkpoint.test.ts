import {
  isXbtMainnetCheckpointHeader,
  XBT_MAINNET_CHECKPOINT_HASH,
  XBT_MAINNET_CHECKPOINT_HEADER,
  XBT_MAINNET_CHECKPOINT_HEIGHT,
} from '../../class/xbt/electrum-checkpoint';

describe('XBT mainnet Electrum checkpoint', () => {
  it('uses the expected fork height and 164-byte v2 header', () => {
    expect(XBT_MAINNET_CHECKPOINT_HEIGHT).toBe(961640);
    expect(XBT_MAINNET_CHECKPOINT_HEADER).toHaveLength(328);
    expect(XBT_MAINNET_CHECKPOINT_HASH).toBe('0000000000000050c1e5f69672f459293be14f46e5a494e7a8c8541396f18eeb');
  });

  it('accepts the verified header independent of hex case', () => {
    expect(isXbtMainnetCheckpointHeader(XBT_MAINNET_CHECKPOINT_HEADER)).toBe(true);
    expect(isXbtMainnetCheckpointHeader(XBT_MAINNET_CHECKPOINT_HEADER.toUpperCase())).toBe(true);
  });

  it('rejects a Bitcoin-length header or any different fork header', () => {
    expect(isXbtMainnetCheckpointHeader(XBT_MAINNET_CHECKPOINT_HEADER.slice(0, 160))).toBe(false);
    expect(isXbtMainnetCheckpointHeader(`01${XBT_MAINNET_CHECKPOINT_HEADER.slice(2)}`)).toBe(false);
  });
});
