const { resetSelftestDevice } = require('../e2e/selftest-reset');
const id = '11111111-2222-3333-4444-555555555555';
function fixture(platform = 'ios') {
  const order = [];
  const device = {
    id,
    getPlatform: () => platform,
    terminateApp: jest.fn(async () => order.push('terminate')),
    clearKeychain: jest.fn(async () => order.push('clear')),
    launchApp: jest.fn(async () => order.push('launch')),
  };
  return { device, order };
}
test('restarts only the selected simulator after clearing Keychain and before reinstall', async () => {
  const { device, order } = fixture();
  const execute = jest.fn((file, args) => {
    expect(file).toBe('xcrun');
    expect(args[2]).toBe(id);
    order.push(args[1]);
  });
  await resetSelftestDevice(device, execute);
  expect(order).toEqual(['terminate', 'clear', 'shutdown', 'boot', 'bootstatus', 'launch']);
  expect(device.launchApp).toHaveBeenCalledWith({ delete: true });
});
test('boot failure stops setup without retry or launch', async () => {
  const { device } = fixture();
  const execute = jest.fn(() => {
    throw new Error('simulator unavailable');
  });
  await expect(resetSelftestDevice(device, execute)).rejects.toThrow('simulator unavailable');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(device.launchApp).not.toHaveBeenCalled();
});
test('Android retains clear and reinstall without simulator commands', async () => {
  const { device, order } = fixture('android');
  const execute = jest.fn();
  await resetSelftestDevice(device, execute);
  expect(order).toEqual(['clear', 'launch']);
  expect(execute).not.toHaveBeenCalled();
});
