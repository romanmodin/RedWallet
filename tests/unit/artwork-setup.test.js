import { prepareArtworkApp, setSimulatorAppearance, denySimulatorNotifications } from '../e2e/artwork-setup';

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
    terminateApp: jest.fn(async () => events.push('terminated')),
    uninstallApp: jest.fn(async () => events.push('uninstalled')),
    installApp: jest.fn(async () => events.push('installed')),
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
  const run = jest.fn((command, args) => {
    if (command === 'applesimutils') {
      events.push('notifications-denied');
      return '';
    }
    events.push(args.length === 5 ? 'set-dark' : 'read-dark');
    return 'dark\n';
  });
  const pending = prepareArtworkApp({ device, setup, waitForReady, run });
  await waitingForReady;
  expect(events).toEqual(['terminated', 'uninstalled', 'cleared', 'installed', 'notifications-denied', 'launched']);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0]).toEqual([
    'applesimutils',
    ['--byId', id, '--bundle', 'com.romanmodin.redwallet', '--restartSB', '--setPermissions', 'notifications=NO'],
    { encoding: 'utf8', timeout: 60000 },
  ]);
  ready();
  expect(await pending).toEqual({
    deviceId: id,
    requested: 'dark',
    observed: 'dark',
  });
  expect(events).toEqual([
    'terminated',
    'uninstalled',
    'cleared',
    'installed',
    'notifications-denied',
    'launched',
    'set-dark',
    'read-dark',
  ]);
  expect(device.launchApp).toHaveBeenCalledWith({ newInstance: false });
  expect(waitForReady).toHaveBeenCalledTimes(2);
});

test.each(['terminate', 'uninstall', 'clear', 'install', 'launch', 'ready'])(
  'failed %s setup never attempts a style change',
  async failing => {
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
      clearKeychain: action('clear'),
      launchApp: action('launch'),
    };
    const run = jest.fn();
    await expect(prepareArtworkApp({ device, setup, waitForReady: action('ready'), run })).rejects.toBe(error);
    expect(run.mock.calls.filter(([command]) => command === 'xcrun')).toEqual([]);
  },
);

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
    clearKeychain: jest.fn(),
    launchApp: jest.fn(),
  };
  const waitForReady = jest.fn().mockResolvedValueOnce().mockRejectedValueOnce(error);
  await expect(prepareArtworkApp({ device, setup, waitForReady, run: () => 'dark' })).rejects.toBe(error);
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
    clearKeychain: jest.fn(),
    installApp: jest.fn(),
    launchApp: jest.fn(),
  };
  const pending = prepareArtworkApp({
    device,
    setup,
    waitForReady: jest.fn(),
    run: jest.fn(),
  });
  expect(device.clearKeychain).not.toHaveBeenCalled();
  expect(device.uninstallApp).not.toHaveBeenCalled();
  rejectTermination(new Error('termination failed'));
  await expect(pending).rejects.toThrow('termination failed');
  expect(device.clearKeychain).not.toHaveBeenCalled();
  expect(device.installApp).not.toHaveBeenCalled();
  expect(device.launchApp).not.toHaveBeenCalled();
});

test('notification reset is a separately bounded setup stage before launch', async () => {
  const stages = [];
  const device = {
    id,
    terminateApp: jest.fn(),
    uninstallApp: jest.fn(),
    clearKeychain: jest.fn(),
    installApp: jest.fn(),
    launchApp: jest.fn(),
  };
  const run = jest.fn(command => (command === 'xcrun' ? 'dark' : ''));
  const tracedSetup = async (name, action, timeoutMs = 60000) => {
    stages.push([name, timeoutMs]);
    return action();
  };
  await prepareArtworkApp({
    device,
    setup: tracedSetup,
    waitForReady: jest.fn(),
    run,
  });
  expect(stages).toEqual([
    ['terminate-before-reset', 60000],
    ['uninstall-before-reset', 60000],
    ['clear-keychain', 120000],
    ['install-clean-app', 60000],
    ['deny-notifications', 60000],
    ['launch-clean-app', 60000],
    ['initial-wallet-list', 60000],
    ['dark-appearance', 60000],
    ['wallet-list-after-appearance', 60000],
  ]);
  expect(device.launchApp).toHaveBeenCalledTimes(1);
  expect(device.launchApp).toHaveBeenCalledWith({ newInstance: false });
});

test('permission failure stops before launch and readiness; it is not retried', async () => {
  const error = Object.assign(new Error('permission reset timed out'), {
    code: 'ETIMEDOUT',
  });
  const device = {
    id,
    terminateApp: jest.fn(),
    uninstallApp: jest.fn(),
    clearKeychain: jest.fn(),
    installApp: jest.fn(),
    launchApp: jest.fn(),
  };
  const waitForReady = jest.fn();
  const run = jest.fn(() => {
    throw error;
  });
  await expect(prepareArtworkApp({ device, setup, waitForReady, run })).rejects.toBe(error);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][0]).toBe('applesimutils');
  expect(device.launchApp).not.toHaveBeenCalled();
  expect(waitForReady).not.toHaveBeenCalled();
});

test('invalid simulator identity cannot reset notifications on a different device', () => {
  const run = jest.fn();
  for (const badId of ['', 'booted', 'another-device']) expect(() => denySimulatorNotifications(run, badId)).toThrow('UUID');
  expect(run).not.toHaveBeenCalled();
});
