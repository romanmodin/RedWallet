import { resetWalletTestApp } from '../e2e/reset-wallet-test-app';
import { resetArtworkSimulator } from '../e2e/artwork-setup';

const id = '11111111-2222-3333-4444-555555555555';
function fixture(platform = 'ios') {
  const events = [];
  let running = true;
  let installed = true;
  let shell = 1;
  const device = {
    id,
    getPlatform: () => platform,
    terminateApp: jest.fn(async () => {
      running = false;
      events.push('terminate');
    }),
    uninstallApp: jest.fn(async () => {
      if (running) throw new Error('live app');
      installed = false;
      events.push('uninstall');
    }),
    installApp: jest.fn(async () => {
      installed = true;
      events.push('install');
    }),
    clearKeychain: jest.fn(async () => events.push('clear')),
    launchApp: jest.fn(async options => {
      if (platform === 'ios' && (!installed || shell !== 2 || options.permissions || options.delete)) throw new Error('unsafe launch');
      events.push('launch');
    }),
  };
  const run = jest.fn((command, args) => {
    if (command === 'applesimutils') {
      if (running || !installed) throw new Error('reset raced live app or install');
      events.push('reset');
      shell = 2;
      return '';
    }
    return 'PID Status Label\n' + shell + ' 0 com.apple.SpringBoard\n';
  });
  return { device, events, run };
}

test.each([{}, { notifications: 'YES' }, { notifications: 'YES', camera: 'YES' }])(
  'fresh wallet launch preserves permissions %j and waits until the replacement shell is observed',
  async permissions => {
    const { device, events, run } = fixture();
    await resetWalletTestApp(device, { permissions, launchArgs: { example: 1 } }, run);
    expect(events).toEqual(['terminate', 'uninstall', 'install', 'reset', 'launch']);
    expect(device.clearKeychain).not.toHaveBeenCalled();
    const resets = run.mock.calls.filter(([command]) => command === 'applesimutils');
    expect(resets).toHaveLength(1);
    if (Object.keys(permissions).length)
      expect(resets[0][1].at(-1)).toBe(
        Object.entries(permissions)
          .map(([k, v]) => k + '=' + v)
          .join(','),
      );
    else expect(resets[0][1]).not.toContain('--setPermissions');
    expect(device.launchApp).toHaveBeenCalledWith({
      launchArgs: { example: 1 },
      newInstance: false,
    });
  },
);

test.each(['terminateApp', 'uninstallApp', 'installApp'])('%s failure stops before any reset or launch', async method => {
  const { device, run } = fixture();
  device[method].mockRejectedValue(new Error('failed ' + method));
  await expect(resetWalletTestApp(device, {}, run)).rejects.toThrow('failed ' + method);
  expect(device[method]).toHaveBeenCalledTimes(1);
  expect(run).not.toHaveBeenCalled();
  expect(device.launchApp).not.toHaveBeenCalled();
});

test('a reset error never launches or retries the reset', async () => {
  const { device, run } = fixture();
  run.mockImplementation(command => {
    if (command === 'applesimutils') throw Object.assign(new Error('reset timed out'), { code: 'ETIMEDOUT' });
    return 'PID Status Label\n1 0 com.apple.SpringBoard\n';
  });
  await expect(resetWalletTestApp(device, {}, run)).rejects.toThrow('reset timed out');
  expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
  expect(device.launchApp).not.toHaveBeenCalled();
});

test('launch failure propagates without resetting or launching again', async () => {
  const { device, run } = fixture();
  device.launchApp.mockRejectedValue(new Error('unknown to FrontBoard'));
  await expect(resetWalletTestApp(device, {}, run)).rejects.toThrow('unknown to FrontBoard');
  expect(device.launchApp).toHaveBeenCalledTimes(1);
  expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
});

test('unchanged shell identities cannot be mistaken for readiness', async () => {
  jest.useFakeTimers();
  try {
    const { device, run } = fixture();
    run.mockImplementation(() => 'PID Status Label\n1 0 com.apple.SpringBoard\n');
    const result = resetWalletTestApp(device, {}, run);
    await Promise.all([expect(result).rejects.toThrow('reset deadline'), jest.advanceTimersByTimeAsync(120000)]);
    expect(device.launchApp).not.toHaveBeenCalled();
    expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
  } finally {
    jest.useRealTimers();
  }
});

test('Android retains its clear/delete launch and permission options', async () => {
  const { device, run, events } = fixture('android');
  const options = { permissions: { notifications: 'YES', camera: 'YES' } };
  await resetWalletTestApp(device, options, run);
  expect(events).toEqual(['clear', 'launch']);
  expect(device.launchApp).toHaveBeenCalledWith({ ...options, delete: true });
  expect(run).not.toHaveBeenCalled();
});

test.each([null, [], { location: 'YES' }, { camera: 'MAYBE' }])(
  'invalid permissions %j fail before any native reset',
  async permissions => {
    const run = jest.fn();
    await expect(resetArtworkSimulator(run, id, { permissions })).rejects.toThrow('Invalid simulator permissions');
    expect(run).not.toHaveBeenCalled();
  },
);
