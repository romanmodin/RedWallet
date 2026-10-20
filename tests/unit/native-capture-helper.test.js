import {
  nativeCaptureEvidence,
  matchesNativeOrientation,
  shouldRepeatOrientation,
  observeNativeRotation,
} from '../e2e/native-capture-helper';

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

test('one observed rotation repeat stays within the existing deadline and never repeats a settled or moving surface', () => {
  const stuck = nativeCaptureEvidence(png, portrait, portrait, 'landscape');
  expect(shouldRepeatOrientation(stuck, 5000, 1)).toBe(true);
  expect(shouldRepeatOrientation(stuck, 4999, 1)).toBe(false);
  expect(shouldRepeatOrientation(stuck, 10000, 1)).toBe(false);
  expect(shouldRepeatOrientation(stuck, 5000, 2)).toBe(false);
  expect(shouldRepeatOrientation(nativeCaptureEvidence(png, portrait, landscape, 'landscape'), 5000, 1)).toBe(false);
  expect(shouldRepeatOrientation(nativeCaptureEvidence(png, landscape, landscape, 'landscape'), 5000, 1)).toBe(false);
});

test('rotation observation checks native state before restoring normal synchronization', async () => {
  const calls = [];
  const device = {
    disableSynchronization: jest.fn(async () => calls.push('disable')),
    enableSynchronization: jest.fn(async () => calls.push('enable')),
  };
  const result = await observeNativeRotation(device, async () => {
    calls.push('observe');
    return matchesNativeOrientation(nativeCaptureEvidence(png, landscape, landscape, 'landscape'));
  });
  expect(result).toBe(true);
  expect(calls).toEqual(['disable', 'observe', 'enable']);
});

test('unsynchronized observation does not accept an unchanged or moving surface', async () => {
  const device = {
    disableSynchronization: jest.fn(),
    enableSynchronization: jest.fn(),
  };
  for (const [before, after] of [
    [portrait, portrait],
    [portrait, landscape],
    [landscape, portrait],
  ]) {
    expect(
      await observeNativeRotation(device, async () => matchesNativeOrientation(nativeCaptureEvidence(png, before, after, 'landscape'))),
    ).toBe(false);
  }
  expect(device.enableSynchronization).toHaveBeenCalledTimes(3);
});

test('observation failure restores synchronization and is not retried or swallowed', async () => {
  const device = {
    disableSynchronization: jest.fn(),
    enableSynchronization: jest.fn(),
  };
  const error = new Error('Native landscape surface never settled');
  const observation = jest.fn(async () => {
    throw error;
  });
  await expect(observeNativeRotation(device, observation)).rejects.toBe(error);
  expect(observation).toHaveBeenCalledTimes(1);
  expect(device.enableSynchronization).toHaveBeenCalledTimes(1);
});

test('a synchronization transport failure prevents observation and still attempts restoration', async () => {
  const error = new Error('transport failed');
  const device = {
    disableSynchronization: jest.fn().mockRejectedValue(error),
    enableSynchronization: jest.fn(),
  };
  const observation = jest.fn();
  await expect(observeNativeRotation(device, observation)).rejects.toBe(error);
  expect(observation).not.toHaveBeenCalled();
  expect(device.enableSynchronization).toHaveBeenCalledTimes(1);
});
