import { resetArtworkSimulator } from './artwork-setup';

// Disposable empty-wallet TLS fixtures only. Never start another simulator
// reset inside launchApp while the Keychain reset is still restarting its shell.
export async function prepareTlsApp({ device, setup, run }) {
  if (device.getPlatform() !== 'ios') {
    await setup('clear-keychain', () => device.clearKeychain(), 120000);
    await setup('launch-clean-app', () => device.launchApp({ delete: true, permissions: { notifications: 'NO' } }));
    return;
  }
  await setup('uninstall-before-reset', () => device.uninstallApp());
  await setup('install-clean-app', () => device.installApp());
  const reset = await setup('reset-keychain-and-notifications', () => resetArtworkSimulator(run, device.id), 120000);
  // Preserve the existing TLS suite's explicit observation-based synchronization
  // policy from process startup, not after launch has waited for native idle.
  await setup('launch-clean-app', () =>
    device.launchApp({
      newInstance: false,
      launchArgs: { detoxEnableSynchronization: 0 },
    }),
  );
  return reset;
}
