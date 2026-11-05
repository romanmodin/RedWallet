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
  // The combined AppleSimulatorUtils reset can leave camera authorization unset
  // on iOS 26. Apply the requested TCC choice after the replacement shell is ready.
  // Unlike another AppleSimulatorUtils permission pass, this does not request a
  // second SpringBoard restart. A failed privacy command must stop the test.
  if (permissions.camera) {
    run(
      'xcrun',
      ['simctl', 'privacy', device.id, permissions.camera === 'YES' ? 'grant' : 'revoke', 'camera', 'com.romanmodin.redwallet'],
      {
        encoding: 'utf8',
        timeout: 15000,
      },
    );
  }
  await device.launchApp({ ...launchOptions, newInstance: false });
}
