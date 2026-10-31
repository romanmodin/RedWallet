import { execFileSync } from 'child_process';
import { resetArtworkSimulator } from './artwork-setup';

// Fresh wallet cases only: terminate the live app BEFORE a Keychain reset can
// restart SpringBoard. Reinstall, reset once, and observe the replacement shell
// before launch. PR154 failed by terminating/reinstalling during that restart.
export async function resetWalletTestApp(device, options = {}, run = execFileSync) {
  if (device.getPlatform() !== 'ios') {
    await device.clearKeychain();
    await device.launchApp({ ...options, delete: true });
    return;
  }
  const { permissions = {}, ...launchOptions } = options;
  await device.terminateApp();
  await device.uninstallApp();
  await device.installApp();
  const reset = await resetArtworkSimulator(run, device.id, { permissions });
  console.info('[wallet-test-reset]', JSON.stringify(reset));
  await device.launchApp({ ...launchOptions, newInstance: false });
}
