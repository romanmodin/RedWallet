import { BlockHeader, compactTarget, SPV_FLOOR_BITS } from '../../class/joinblaket/spv';
import fixture from '../fixtures/joinblaket/block-headers.json';

test.each(fixture.vectors)('header hash and merkle inclusion match Knots at $height', v => {
  const h = BlockHeader.parse(v.header);
  expect(h.hash).toBe(v.hash);
  expect(h.bits).toBe(parseInt(v.bits, 16));
  expect(h.time).toBe(v.time);
  expect(h.includes(v.txid, v.branch, v.pos)).toBe(true);
  expect(h.meetsTarget(h.extended ? SPV_FLOOR_BITS : 0x1d00ffff)).toBe(true);
  expect(h.height).toBe(h.extended ? v.height : null);
  expect(Object.isFrozen(h)).toBe(true);
  expect(h.includes('ab'.repeat(32), v.branch, v.pos)).toBe(false);
  expect(h.includes(v.txid, v.branch, v.pos + 2 ** v.branch.length)).toBe(false);
  expect(h.includes(v.txid, v.branch, -1)).toBe(false);
  if (v.branch.length) expect(h.includes(v.txid, ['ab'.repeat(32), ...v.branch.slice(1)], v.pos)).toBe(false);
});

test('rejects malformed headers and invalid compact targets instead of saturating', () => {
  for (const bits of [0, 0x01003456, 0x01800000, 0x1d80ffff, 0x23000001, 0x22000100, 0x21010000, 0xffffffff, -1, 1.5]) {
    expect(() => compactTarget(bits)).toThrow();
  }
  expect(compactTarget(0x1d00ffff)).toBe(65535n * 256n ** 26n);
  expect(compactTarget(0x220000ff)).toBe(255n * 256n ** 31n);
  expect(compactTarget(0x03009234)).toBe(0x9234n);
  const v = fixture.vectors[1];
  for (const hex of [v.header + '00', v.header.slice(0, 160), '00'.repeat(80), 'gg'.repeat(164), v.header + '\n']) {
    expect(() => BlockHeader.parse(hex)).toThrow();
  }
  expect(BlockHeader.parse(fixture.vectors[0].header).meetsTarget()).toBe(false);
});

test('PoW and merkle checks reject changed header data and malformed paths', () => {
  const v = fixture.vectors[2],
    bytes = Buffer.from(v.header, 'hex');
  bytes[76] += 1;
  expect(BlockHeader.parse(bytes.toString('hex')).meetsTarget()).toBe(false);
  const h = BlockHeader.parse(v.header);
  expect(h.includes(v.txid, Array(33).fill('00'.repeat(32)), 0)).toBe(false);
  expect(h.includes(v.txid, ['00'], 0)).toBe(false);
  expect(h.includes(v.txid, v.branch, 0x100000000)).toBe(false);
  expect(h.includes(v.txid, v.branch, 1.5)).toBe(false);
});
