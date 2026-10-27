import { prepareArtworkApp, setSimulatorAppearance } from '../e2e/artwork-setup';

const id = 'A00461C1-53DC-43E1-8399-D43CB4D3E301';
const setup = (_name, action) => action();

test('style commands wait for clean launch and actual app readiness after Keychain reset', async () => {
  let ready;
  let reachedReady;
  const waitingForReady = new Promise(resolve => {
    reachedReady = resolve;
  });
  const events = [];
  const device = {
    id,
    clearKeychain: jest.fn(async () => events.push('cleared')),
    launchApp: jest.fn(async () => events.push('launched')),
  };
  const waitForReady = jest
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          ready = resolve;
          reachedReady();
        }),
    )
    .mockResolvedValueOnce();
  const run = jest.fn((_command, args) => {
    events.push(args.length === 5 ? 'set-dark' : 'read-dark');
    return 'dark\n';
  });
  const pending = prepareArtworkApp({ device, setup, waitForReady, run });
  await waitingForReady;
  expect(events).toEqual(['cleared', 'launched']);
  expect(run).not.toHaveBeenCalled();
  ready();
  expect(await pending).toEqual({ deviceId: id, requested: 'dark', observed: 'dark' });
  expect(events).toEqual(['cleared', 'launched', 'set-dark', 'read-dark']);
  expect(device.launchApp).toHaveBeenCalledWith({ delete: true, permissions: { notifications: 'NO' } });
  expect(waitForReady).toHaveBeenCalledTimes(2);
});

test.each(['clear', 'launch', 'ready'])('failed %s setup never attempts a style change', async failing => {
  const error = new Error('native setup failed');
  const action = stage =>
    jest.fn(async () => {
      if (stage === failing) throw error;
    });
  const device = { id, clearKeychain: action('clear'), launchApp: action('launch') };
  const run = jest.fn();
  await expect(prepareArtworkApp({ device, setup, waitForReady: action('ready'), run })).rejects.toBe(error);
  expect(run).not.toHaveBeenCalled();
});

test.each(['dark', 'light'])('reads back %s on the exact simulator with bounded commands', appearance => {
  const run = jest
    .fn()
    .mockReturnValueOnce('')
    .mockReturnValueOnce(appearance + '\n');
  expect(setSimulatorAppearance(run, id, appearance)).toEqual({ deviceId: id, requested: appearance, observed: appearance });
  expect(run.mock.calls).toEqual([
    ['xcrun', ['simctl', 'ui', id, 'appearance', appearance], { encoding: 'utf8', timeout: 15000 }],
    ['xcrun', ['simctl', 'ui', id, 'appearance'], { encoding: 'utf8', timeout: 15000 }],
  ]);
});

test('a successful setter cannot conceal a wrong or missing observed appearance', () => {
  for (const observed of ['light', '', 'unknown']) {
    const run = jest.fn().mockReturnValueOnce('').mockReturnValueOnce(observed);
    expect(() => setSimulatorAppearance(run, id, 'dark')).toThrow('Simulator appearance did not match');
    expect(run).toHaveBeenCalledTimes(2);
  }
});

test.each([1, 2])('native command %i failure propagates exactly without retry', failedCommand => {
  const error = Object.assign(new Error('native timeout'), { code: 'ETIMEDOUT' });
  const run = jest.fn();
  if (failedCommand === 2) run.mockReturnValueOnce('');
  run.mockImplementationOnce(() => {
    throw error;
  });
  expect(() => setSimulatorAppearance(run, id, 'dark')).toThrow(error);
  expect(run).toHaveBeenCalledTimes(failedCommand);
});

test('invalid simulator identities and styles never invoke native commands', () => {
  const run = jest.fn();
  for (const badId of ['', 'booted', 'another-device']) expect(() => setSimulatorAppearance(run, badId, 'dark')).toThrow('UUID');
  expect(() => setSimulatorAppearance(run, id, 'automatic')).toThrow('appearance');
  expect(run).not.toHaveBeenCalled();
});

test('losing the visible app after changing style cannot pass setup', async () => {
  const error = new Error('app disappeared');
  const device = { id, clearKeychain: jest.fn(), launchApp: jest.fn() };
  const waitForReady = jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(error);
  await expect(prepareArtworkApp({ device, setup, waitForReady, run: () => 'dark' })).rejects.toBe(error);
});
