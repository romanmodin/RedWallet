import { PNG } from 'pngjs';
import { balanceInkHeight, checkBalanceSamples } from '../e2e/wallet-card-balance-capture';

function balanceCrop(points, scale, opaque) {
  const png = new PNG({ width: 100 * scale, height: 40 * scale });
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = (y * png.width + x) * 4;
      const glyph = x >= 4 * scale && x < 7 * scale && y >= 2 * scale && y < (points + 2) * scale;
      const color = glyph ? [230, 220, 220, 235] : [120, 30, 45, opaque ? 255 : 0];
      png.data.set(color, i);
    }
  }
  return PNG.sync.write(png);
}

test.each([2, 3])('measures the same printed height at %ix on opaque and transparent crops', scale => {
  for (const opaque of [false, true]) {
    expect(balanceInkHeight(balanceCrop(24, scale, opaque), 100)).toBe(24);
    expect(balanceInkHeight(balanceCrop(4, scale, opaque), 100)).toBe(4);
    expect(balanceInkHeight(balanceCrop(0, scale, opaque), 100)).toBe(0);
  }
});

test('a normal restart cannot mask a single shrunken sample earlier in the session', () => {
  const opening = { phase: 'initial', inkHeight: 24 };
  const restarted = { phase: 'relaunched', inkHeight: 24 };
  expect(() => checkBalanceSamples([opening, { phase: 'idle', inkHeight: 24.5 }, restarted])).not.toThrow();
  expect(() => checkBalanceSamples([opening, { phase: 'idle', inkHeight: 4 }, restarted])).toThrow('idle');
  expect(() => checkBalanceSamples([opening, { phase: 'return', inkHeight: 16 }, restarted])).toThrow('return');
  expect(() => checkBalanceSamples([{ phase: 'initial', inkHeight: 4 }, restarted])).toThrow('initial');
});
