import { prepareArtworkApp, setSimulatorAppearance, resetArtworkSimulator } from '../e2e/artwork-setup';

const id = 'A00461C1-53DC-43E1-8399-D43CB4D3E301';
const setup = (_name, action) => action();
const table = pid => 'PID\tStatus\tLabel\n' + pid + '\t0\tcom.apple.SpringBoard\n';
const makeRun = () => {
  let reads = 0;
  return jest.fn((command, args) => {
    if (command === 'applesimutils') return '';
    if (args.includes('launchctl')) return table(++reads);
    return 'dark\n';
  });
};

test('style commands wait for clean launch and actual app readiness after the combined reset', async () => {
  let ready;
  let reachedReady;
  const waitingForReady = new Promise(resolve => {
    reachedReady = resolve;
  });
  const events = [];
  const device = {
    id,
    terminateApp: jest.fn(async () => events.push('terminated')),
    uninstallApp: jest.fn(async () => events.push('uninstalled')),
    installApp: jest.fn(async () => events.push('installed')),
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
  const nativeRun = makeRun();
  const run = jest.fn((command, args, options) => {
    if (command === 'applesimutils') events.push('reset');
    else if (args.includes('appearance')) events.push(args.length === 5 ? 'set-dark' : 'read-dark');
    return nativeRun(command, args, options);
  });
  const pending = prepareArtworkApp({ device, setup, waitForReady, run });
  await waitingForReady;
  expect(events).toEqual(['terminated', 'uninstalled', 'installed', 'reset', 'launched']);
  expect(run.mock.calls.filter(([, args]) => args.includes('appearance'))).toHaveLength(0);
  ready();
  const result = await pending;
  expect(result).toMatchObject({
    deviceId: id,
    requested: 'dark',
    observed: 'dark',
    reset: {
      deviceId: id,
      before: { springboard: 1 },
      after: { springboard: 2 },
    },
  });
  expect(events).toEqual(['terminated', 'uninstalled', 'installed', 'reset', 'launched', 'set-dark', 'read-dark']);
  expect(device.launchApp).toHaveBeenCalledWith({ newInstance: false });
  expect(waitForReady).toHaveBeenCalledTimes(2);
});

test.each(['terminate', 'uninstall', 'install', 'launch', 'ready'])('failed %s setup never attempts a style change', async failing => {
  const error = new Error('native setup failed');
  const action = stage =>
    jest.fn(async () => {
      if (stage === failing) throw error;
    });
  const device = {
    id,
    terminateApp: action('terminate'),
    uninstallApp: action('uninstall'),
    installApp: action('install'),
    launchApp: action('launch'),
  };
  const run = makeRun();
  await expect(prepareArtworkApp({ device, setup, waitForReady: action('ready'), run })).rejects.toBe(error);
  expect(run.mock.calls.filter(([, args]) => args.includes('appearance'))).toEqual([]);
});

test.each(['dark', 'light'])('reads back %s on the exact simulator with bounded commands', appearance => {
  const run = jest
    .fn()
    .mockReturnValueOnce('')
    .mockReturnValueOnce(appearance + '\n');
  expect(setSimulatorAppearance(run, id, appearance)).toEqual({
    deviceId: id,
    requested: appearance,
    observed: appearance,
  });
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
  const error = Object.assign(new Error('native timeout'), {
    code: 'ETIMEDOUT',
  });
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
  const device = {
    id,
    terminateApp: jest.fn(),
    uninstallApp: jest.fn(),
    installApp: jest.fn(),
    launchApp: jest.fn(),
  };
  const waitForReady = jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(error);
  await expect(prepareArtworkApp({ device, setup, waitForReady, run: makeRun() })).rejects.toBe(error);
});

test('reset operations settle before the next begins; failure leaves the app unlaunched', async () => {
  let rejectTermination;
  const device = {
    id,
    terminateApp: jest.fn(
      () =>
        new Promise((_resolve, reject) => {
          rejectTermination = reject;
        }),
    ),
    uninstallApp: jest.fn(),
    installApp: jest.fn(),
    launchApp: jest.fn(),
  };
  const run = makeRun();
  const pending = prepareArtworkApp({
    device,
    setup,
    waitForReady: jest.fn(),
    run,
  });
  expect(device.uninstallApp).not.toHaveBeenCalled();
  rejectTermination(new Error('termination failed'));
  await expect(pending).rejects.toThrow('termination failed');
  expect(device.installApp).not.toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
  expect(device.launchApp).not.toHaveBeenCalled();
});

test('combined reset and readiness share the original Keychain budget; launch deadline is unchanged', async () => {
  const stages = [];
  const device = {
    id,
    terminateApp: jest.fn(),
    uninstallApp: jest.fn(),
    installApp: jest.fn(),
    launchApp: jest.fn(),
  };
  await prepareArtworkApp({
    device,
    waitForReady: jest.fn(),
    run: makeRun(),
    setup: async (name, action, timeoutMs = 60000) => {
      stages.push([name, timeoutMs]);
      return action();
    },
  });
  expect(stages).toEqual([
    ['terminate-before-reset', 60000],
    ['uninstall-before-reset', 60000],
    ['install-clean-app', 60000],
    ['reset-keychain-and-notifications', 120000],
    ['launch-clean-app', 60000],
    ['initial-wallet-list', 60000],
    ['dark-appearance', 60000],
    ['wallet-list-after-appearance', 60000],
  ]);
  expect(device.launchApp).toHaveBeenCalledTimes(1);
});

test('permission/reset command failure stops before launch and readiness; it is not retried', async () => {
  const error = Object.assign(new Error('permission reset timed out'), {
    code: 'ETIMEDOUT',
  });
  const device = {
    id,
    terminateApp: jest.fn(),
    uninstallApp: jest.fn(),
    installApp: jest.fn(),
    launchApp: jest.fn(),
  };
  const waitForReady = jest.fn();
  const run = jest.fn(command => {
    if (command === 'applesimutils') throw error;
    return table(1);
  });
  await expect(prepareArtworkApp({ device, setup, waitForReady, run })).rejects.toBe(error);
  expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
  expect(device.launchApp).not.toHaveBeenCalled();
  expect(waitForReady).not.toHaveBeenCalled();
});

test('invalid simulator identity cannot reset a different device', async () => {
  const run = jest.fn();
  for (const badId of ['', 'booted', 'another-device']) await expect(resetArtworkSimulator(run, badId)).rejects.toThrow('UUID');
  expect(run).not.toHaveBeenCalled();
});
