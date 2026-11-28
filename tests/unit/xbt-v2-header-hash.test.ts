import { xbtV2BlockHash } from '../../class/xbt/block-header-hash';
import { XBT_MAINNET_CHECKPOINT_HASH, XBT_MAINNET_CHECKPOINT_HEADER } from '../../class/xbt/electrum-checkpoint';
// Serialized headers and expected IDs from Knots b4c8f9f4, src/test/data/block_header_v2.json.
import vectors from '../fixtures/xbt-v2-header-vectors.json';

test.each(vectors)('matches the upstream $name block hash', ({ serialized, block_hash }) => {
  expect(xbtV2BlockHash(Buffer.from(serialized, 'hex'))).toBe(block_hash);
});
test('matches the pinned first BLAKE2b mainnet block', () => {
  expect(xbtV2BlockHash(Buffer.from(XBT_MAINNET_CHECKPOINT_HEADER, 'hex'))).toBe(XBT_MAINNET_CHECKPOINT_HASH);
});
