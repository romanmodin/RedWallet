import { nativeCaptureEvidence, matchesNativeOrientation } from '../e2e/native-capture-helper';

const png = Buffer.alloc(24);
Buffer.from('89504e470d0a1a0a', 'hex').copy(png);
png.write('IHDR', 12);
png.writeUInt32BE(1206, 16);
png.writeUInt32BE(2622, 20);
const portrait = { elementBounds: { width: 402, height: 780 } };
const landscape = { elementBounds: { width: 874, height: 330 } };

test('native rotated layout qualifies even when the simulator retains portrait framebuffer dimensions', () => {
  const evidence = nativeCaptureEvidence(png, landscape, landscape, 'landscape');
  expect(evidence.pixels).toEqual({ width: 1206, height: 2622 });
  expect(evidence.after).toEqual({ width: 874, height: 330 });
  expect(evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(matchesNativeOrientation(evidence)).toBe(true);
});

test('unchanged or still-transitioning UIKit layout cannot qualify as landscape', () => {
  expect(matchesNativeOrientation(nativeCaptureEvidence(png, portrait, portrait, 'landscape'))).toBe(false);
  expect(matchesNativeOrientation(nativeCaptureEvidence(png, portrait, landscape, 'landscape'))).toBe(false);
  expect(matchesNativeOrientation(nativeCaptureEvidence(png, landscape, portrait, 'landscape'))).toBe(false);
  expect(matchesNativeOrientation(nativeCaptureEvidence(png, portrait, portrait, 'portrait'))).toBe(true);
  expect(matchesNativeOrientation(nativeCaptureEvidence(png, landscape, landscape, 'portrait'))).toBe(false);
});

test('missing native dimensions and invalid screenshots fail closed', () => {
  expect(() => nativeCaptureEvidence(png, {}, landscape, 'landscape')).toThrow('native surface');
  expect(() => nativeCaptureEvidence(Buffer.alloc(24), landscape, landscape, 'landscape')).toThrow('PNG');
  expect(() => nativeCaptureEvidence(png, landscape, landscape, 'sideways')).toThrow('orientation');
});
