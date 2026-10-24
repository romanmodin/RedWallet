const { launchNativeClean } = require('../e2e/launch-native-clean');
const options = { permissions: { notifications: 'NO' }, launchArgs: { detoxEnableSynchronization: 0 } };
function fixture(platform = 'ios') {
  const order = [];
  const device = {
    getPlatform: () => platform,
    uninstallApp: jest.fn(async () => order.push('uninstall')),
    installApp: jest.fn(async () => order.push('install')),
    launchApp: jest.fn(async () => order.push('launch')),
  };
  return { device, order };
}
test('iOS preserves clean reinstall and launch options without absent-process termination', async () => {
  const { device, order } = fixture();
  await launchNativeClean(device, options);
  expect(order).toEqual(['uninstall', 'install', 'launch']);
  expect(device.launchApp).toHaveBeenCalledWith({ ...options, newInstance: false });
});
test.each(['uninstallApp', 'installApp', 'launchApp'])('%s failure propagates without retry or later actions', async method => {
  const { device } = fixture();
  device[method].mockRejectedValue(new Error('setup failed'));
  await expect(launchNativeClean(device, options)).rejects.toThrow('setup failed');
  expect(device[method]).toHaveBeenCalledTimes(1);
  if (method === 'uninstallApp') expect(device.installApp).not.toHaveBeenCalled();
  if (method !== 'launchApp') expect(device.launchApp).not.toHaveBeenCalled();
});
test('Android retains the existing delete launch', async () => {
  const { device, order } = fixture('android');
  await launchNativeClean(device, options);
  expect(order).toEqual(['launch']);
  expect(device.launchApp).toHaveBeenCalledWith({ ...options, delete: true });
});
