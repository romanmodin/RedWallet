const { execFileSync } = require('child_process');

// Reset only the disposable simulator, before the unchanged self-test begins.
// A Keychain reset can crash SpringBoard; do not let Detox retry termination
// against that stale shell until the outer test deadline expires.
async function resetSelftestDevice(device, execute = execFileSync) {
  if (device.getPlatform() === 'ios') await device.terminateApp();
  await device.clearKeychain();
  if (device.getPlatform() === 'ios') {
    const id = device.id;
    if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Invalid self-test simulator identity');
    execute('xcrun', ['simctl', 'shutdown', id], { timeout: 30000, stdio: 'pipe' });
    execute('xcrun', ['simctl', 'boot', id], { timeout: 30000, stdio: 'pipe' });
    execute('xcrun', ['simctl', 'bootstatus', id, '-b'], { timeout: 90000, stdio: 'pipe' });
  }
  await device.launchApp({ delete: true });
}
module.exports = { resetSelftestDevice };
