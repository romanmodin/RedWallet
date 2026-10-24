import {
  nativeCaptureEvidence,
  matchesNativeOrientation,
  shouldRepeatOrientation,
  observeNativeRotation,
  attachSimulatorForRotation,
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

test('post-capture confirmation qualifies while retaining a stale pre-capture measurement', () => {
  const evidence = nativeCaptureEvidence(png, landscape, landscape, 'landscape', portrait);
  expect(evidence.preCapture).toEqual({ width: 402, height: 780 });
  expect(matchesNativeOrientation(evidence)).toBe(true);
});

test('unchanged or still-transitioning post-capture UIKit layout cannot qualify as landscape', () => {
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

const selectedSimulator = 'F94FB7BA-C33C-4B3B-B505-F0FB478DB847';
const parkedSimulator = '35645D16-2FFD-44E1-BA44-5774817F1687';
const simulatorInventory = devices => JSON.stringify({ devices: { 'iOS-26-5': devices } });
test('rotation GUI launch forces a new instance for the sole booted selected device, ignoring a parked twin', () => {
  const run = jest.fn().mockReturnValueOnce(
    simulatorInventory([
      { udid: selectedSimulator, state: 'Booted' },
      { udid: parkedSimulator, state: 'Shutdown' },
    ]),
  );
  expect(attachSimulatorForRotation(run, selectedSimulator)).toEqual({
    requestedDeviceId: selectedSimulator,
    bootedDeviceIds: [selectedSimulator],
    newGuiInstanceRequested: true,
  });
  expect(run.mock.calls).toEqual([
    ['xcrun', ['simctl', 'list', 'devices', '-j'], { encoding: 'utf8', timeout: 15000 }],
    ['open', ['-n', '-a', 'Simulator', '--args', '-CurrentDeviceUDID', selectedSimulator], { timeout: 15000 }],
  ]);
});

test.each([
  [],
  [{ udid: parkedSimulator, state: 'Booted' }],
  [
    { udid: selectedSimulator, state: 'Booted' },
    { udid: parkedSimulator, state: 'Booted' },
  ],
  [{ udid: selectedSimulator, state: 'Booting' }],
])('ambiguous or wrong boot state never opens a GUI', (...devices) => {
  const run = jest.fn().mockReturnValue(simulatorInventory(devices));
  expect(() => attachSimulatorForRotation(run, selectedSimulator)).toThrow();
  expect(run).toHaveBeenCalledTimes(1);
});

test('invalid UUID and inventory/launch errors fail closed without retries', () => {
  const run = jest.fn();
  expect(() => attachSimulatorForRotation(run, 'bad')).toThrow('UUID');
  expect(run).not.toHaveBeenCalled();
  run.mockReturnValueOnce('not JSON');
  expect(() => attachSimulatorForRotation(run, selectedSimulator)).toThrow();
  expect(run).toHaveBeenCalledTimes(1);
  const failure = new Error('launch timeout');
  const launch = jest
    .fn()
    .mockReturnValueOnce(simulatorInventory([{ udid: selectedSimulator, state: 'Booted' }]))
    .mockImplementationOnce(() => {
      throw failure;
    });
  expect(() => attachSimulatorForRotation(launch, selectedSimulator)).toThrow(failure);
  expect(launch).toHaveBeenCalledTimes(2);
});
