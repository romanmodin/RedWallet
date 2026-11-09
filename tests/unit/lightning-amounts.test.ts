import {
  MAX_LIGHTNING_SATS,
  MAX_LIGHTNING_FEE_RATE,
  validLightningSats,
  validLightningFeeRate,
  validLightningChannelOpenSats,
} from '../../blue_modules/lightning-amounts';

test('large amounts stay exact across the bridge and millisatoshi conversion', () => {
  for (const sats of ['1000001', '44000000', String(MAX_LIGHTNING_SATS)]) expect(validLightningSats(sats)).toBe(true);
  expect(BigInt(MAX_LIGHTNING_SATS) * 1000n).toBeLessThanOrEqual(9223372036854775807n);
});
test.each(['', '0', '-1', '1.1', '1e8', '01', ' 1', 'Infinity', '2100000000000001', '9007199254740993'])(
  'rejects malformed/out-of-domain amount %s',
  amount => {
    expect(validLightningSats(amount)).toBe(false);
  },
);
test('fees can exceed the old ceiling while the reviewed closing ceiling cannot overflow', () => {
  expect(validLightningSats('0', true)).toBe(true);
  expect(validLightningFeeRate('250')).toBe(true);
  expect(validLightningFeeRate(String(MAX_LIGHTNING_FEE_RATE))).toBe(true);
  expect(Number.isSafeInteger(MAX_LIGHTNING_FEE_RATE * 3)).toBe(true);
  expect(BigInt(MAX_LIGHTNING_FEE_RATE) * 3000n).toBeLessThanOrEqual(9223372036854775807n);
  for (const rate of ['0', '-1', '2.5', String(MAX_LIGHTNING_FEE_RATE + 1)]) expect(validLightningFeeRate(rate)).toBe(false);
});

test('the 10 million sat cap applies only to opening new channels', () => {
  expect(validLightningChannelOpenSats('10000000')).toBe(true);
  for (const amount of ['10000001', '44000000', '0', '-1', '1.1', '1e7']) expect(validLightningChannelOpenSats(amount)).toBe(false);
  expect(validLightningSats('44000000')).toBe(true);
});

test('fee rates keep LND signed products safe through maximum transaction size and close negotiation', () => {
  const maxSigned = 9223372036854775807n;
  const rate = BigInt(MAX_LIGHTNING_FEE_RATE);
  for (const multiplier of [1n, 3n]) {
    const perKVByte = rate * multiplier * 1000n;
    const perKWeight = perKVByte / 4n;
    expect(perKVByte * 1000000n + 999n).toBeLessThanOrEqual(maxSigned);
    for (const weight of [224n, 724n, 4000000n]) {
      expect(perKWeight * weight + 999n).toBeLessThanOrEqual(maxSigned);
    }
  }
  // The former bridge-only bound overflowed even a small 724-WU transaction.
  const priorRate = 3002399751580330n;
  expect(priorRate * 250n * 724n).toBeGreaterThan(maxSigned);
  expect(validLightningFeeRate(String(priorRate))).toBe(false);
  expect(validLightningFeeRate('1000000')).toBe(true);
  expect((rate + 1n) * 3000n * 1000000n + 999n).toBeGreaterThan(maxSigned);
});
