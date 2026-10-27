// Test-driver setup only. Keychain/permission resets can restart SpringBoard.
// A visible app is the readiness barrier before asking SpringBoard to change style.
export function setSimulatorAppearance(run, deviceId, appearance) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('Invalid simulator UUID');
  if (!['dark', 'light'].includes(appearance)) throw new Error('Invalid simulator appearance');
  const args = ['simctl', 'ui', deviceId, 'appearance'];
  const options = { encoding: 'utf8', timeout: 15000 };
  run('xcrun', [...args, appearance], options);
  const observed = run('xcrun', args, options).trim();
  if (observed !== appearance) throw new Error('Simulator appearance did not match: ' + observed);
  return { deviceId, requested: appearance, observed };
}

// Match Detox's notifications=NO operation, but keep the SpringBoard restart
// outside launchApp's separate readiness budget. Never retry a failed command.
export function denySimulatorNotifications(run, deviceId) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('Invalid simulator UUID');
  return run(
    'applesimutils',
    ['--byId', deviceId, '--bundle', 'com.romanmodin.redwallet', '--restartSB', '--setPermissions', 'notifications=NO'],
    { encoding: 'utf8', timeout: 60000 },
  );
}

export async function prepareArtworkApp({ device, setup, waitForReady, run }) {
  // Terminate and remove the app before Keychain reset can restart SpringBoard.
  // launchApp(delete:true) previously tried to terminate it during that restart.
  // Keep each operation bounded and stop on the first failure.
  await setup('terminate-before-reset', () => device.terminateApp());
  await setup('uninstall-before-reset', () => device.uninstallApp());
  await setup('clear-keychain', () => device.clearKeychain(), 120000);
  await setup('install-clean-app', () => device.installApp());
  await setup('deny-notifications', () => denySimulatorNotifications(run, device.id));
  await setup('launch-clean-app', () => device.launchApp({ newInstance: false }));
  await setup('initial-wallet-list', waitForReady);
  const appearance = await setup('dark-appearance', () => setSimulatorAppearance(run, device.id, 'dark'));
  await setup('wallet-list-after-appearance', waitForReady);
  return appearance;
}
