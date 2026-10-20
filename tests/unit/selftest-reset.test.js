const { resetSelftestDevice } = require('../e2e/selftest-reset');
const id = '11111111-2222-3333-4444-555555555555';
function fixture(platform = 'ios') {
  const order = [];
  const device = {
    id,
    getPlatform: () => platform,
    terminateApp: jest.fn(async () => order.push('terminate')),
    clearKeychain: jest.fn(async () => order.push('clear')),
    resetContentAndSettings: jest.fn(async () => order.push('reset')),
    launchApp: jest.fn(async () => order.push('launch')),
  };
  return { device, order };
}
beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());
test('uses the selected device lifecycle reset before reinstalling the self-test app', async () => {
  const { device, order } = fixture();
  await resetSelftestDevice(device);
  expect(order).toEqual(['terminate', 'reset', 'launch']);
  expect(device.resetContentAndSettings).toHaveBeenCalledTimes(1);
  expect(device.clearKeychain).not.toHaveBeenCalled();
  expect(device.launchApp).toHaveBeenCalledWith({ delete: true });
  expect(jest.getTimerCount()).toBe(0);
});
test('failed reset stops setup without retry or launch', async () => {
  const { device } = fixture();
  device.resetContentAndSettings.mockRejectedValue(new Error('simulator unavailable'));
  await expect(resetSelftestDevice(device)).rejects.toThrow('simulator unavailable');
  expect(device.resetContentAndSettings).toHaveBeenCalledTimes(1);
  expect(device.launchApp).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test('a stalled reset fails at the original aggregate budget and never launches afterwards', async () => {
  const { device } = fixture();
  let finishReset;
  device.resetContentAndSettings.mockImplementation(
    () =>
      new Promise(resolve => {
        finishReset = resolve;
      }),
  );
  const result = resetSelftestDevice(device);
  await Promise.all([
    expect(result).rejects.toThrow('Self-test simulator reset exceeded 150 seconds'),
    jest.advanceTimersByTimeAsync(150000),
  ]);
  finishReset();
  await Promise.resolve();
  expect(device.resetContentAndSettings).toHaveBeenCalledTimes(1);
  expect(device.launchApp).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
test('invalid simulator identity fails before any device mutation', async () => {
  const { device, order } = fixture();
  device.id = 'booted';
  await expect(resetSelftestDevice(device)).rejects.toThrow('Invalid self-test simulator identity');
  expect(order).toEqual([]);
});
test('termination failure does not clear, reset or launch', async () => {
  const { device } = fixture();
  device.terminateApp.mockRejectedValue(new Error('termination failed'));
  await expect(resetSelftestDevice(device)).rejects.toThrow('termination failed');
  expect(device.resetContentAndSettings).not.toHaveBeenCalled();
  expect(device.clearKeychain).not.toHaveBeenCalled();
  expect(device.launchApp).not.toHaveBeenCalled();
});
test('Android retains clear and reinstall without simulator reset', async () => {
  const { device, order } = fixture('android');
  await resetSelftestDevice(device);
  expect(order).toEqual(['clear', 'launch']);
  expect(device.resetContentAndSettings).not.toHaveBeenCalled();
});
