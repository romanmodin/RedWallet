import { prepareTlsApp } from '../e2e/tls-setup';

const id = '149A9C8F-4605-4260-A309-1E70B462538E';
function fixture(platform = 'ios') {
  const order = [];
  let reset = false;
  let settled = false;
  const run = jest.fn(command => {
    if (command === 'applesimutils') {
      order.push('combined-reset');
      reset = true;
      return '';
    }
    if (reset) settled = true;
    return 'PID Status Label\n' + (reset ? '101' : '100') + ' 0 com.apple.SpringBoard\n';
  });
  const device = { id, getPlatform: () => platform };
  for (const name of ['uninstallApp', 'installApp', 'clearKeychain']) device[name] = jest.fn(async () => order.push(name));
  device.launchApp = jest.fn(async options => {
    if (platform === 'ios') {
      if (!settled) throw new Error('launch raced shell restart');
      if (options.delete || options.permissions) throw new Error('second reset inside launch');
    }
    order.push('launch');
  });
  const setup = jest.fn(async (_name, action) => action());
  return { device, setup, run, order };
}

test('iOS launches once only after the real readiness helper observes replacement shell identity', async () => {
  const f = fixture();
  const receipt = await prepareTlsApp(f);
  expect(f.order).toEqual(['uninstallApp', 'installApp', 'combined-reset', 'launch']);
  expect(receipt.before.springboard).toBe(100);
  expect(receipt.after.springboard).toBe(101);
  expect(f.device.launchApp).toHaveBeenCalledWith({
    newInstance: false,
    launchArgs: { detoxEnableSynchronization: 0 },
  });
  expect(f.device.clearKeychain).not.toHaveBeenCalled();
  expect(f.setup.mock.calls.find(([name]) => name === 'reset-keychain-and-notifications')[2]).toBe(120000);
});

test('old reset-plus-delete/permissions launch races the shell before readiness is observed', async () => {
  const f = fixture();
  await f.device.clearKeychain();
  await expect(f.device.launchApp({ delete: true, permissions: { notifications: 'NO' } })).rejects.toThrow('launch raced shell restart');
});

test.each(['uninstallApp', 'installApp', 'launchApp'])('%s failure is not retried or ignored', async name => {
  const f = fixture();
  f.device[name].mockRejectedValue(new Error(name + ' failed'));
  await expect(prepareTlsApp(f)).rejects.toThrow(name + ' failed');
  expect(f.device[name]).toHaveBeenCalledTimes(1);
  if (name !== 'launchApp') expect(f.device.launchApp).not.toHaveBeenCalled();
});

test('malformed process evidence prevents launch and does not reset again', async () => {
  const f = fixture();
  f.run.mockReturnValue('unusable process listing');
  await expect(prepareTlsApp(f)).rejects.toThrow('Invalid simulator process table');
  expect(f.device.launchApp).not.toHaveBeenCalled();
  expect(f.run).toHaveBeenCalledTimes(1);
});

test('reset failure cannot reach launch', async () => {
  const f = fixture();
  f.run.mockImplementation(command => {
    if (command === 'applesimutils') throw new Error('reset failed');
    return 'PID Status Label\n100 0 com.apple.SpringBoard\n';
  });
  await expect(prepareTlsApp(f)).rejects.toThrow('reset failed');
  expect(f.device.launchApp).not.toHaveBeenCalled();
});

test('Android retains its original clean launch and permissions', async () => {
  const f = fixture('android');
  await prepareTlsApp(f);
  expect(f.order).toEqual(['clearKeychain', 'launch']);
  expect(f.device.launchApp).toHaveBeenCalledWith({
    delete: true,
    permissions: { notifications: 'NO' },
  });
  expect(f.run).not.toHaveBeenCalled();
});
