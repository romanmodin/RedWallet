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

export async function prepareArtworkApp({ device, setup, waitForReady, run }) {
  await setup('clear-keychain', () => device.clearKeychain(), 120000);
  await setup('launch-clean-app', () => device.launchApp({ delete: true, permissions: { notifications: 'NO' } }));
  await setup('initial-wallet-list', waitForReady);
  const appearance = await setup('dark-appearance', () => setSimulatorAppearance(run, device.id, 'dark'));
  await setup('wallet-list-after-appearance', waitForReady);
  return appearance;
}
