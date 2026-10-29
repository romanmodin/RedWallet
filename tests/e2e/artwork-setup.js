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

// AppleSimulatorUtils exits after stopping SpringBoard, not after its replacement
// is ready. Clear Keychain and deny notifications in ONE native invocation so a
// second reset cannot interrupt the first restart (observed in 40631701286).
export function simulatorServicePids(output) {
  if (!/^\s*PID\s+Status\s+Label\s*$/m.test(output)) throw new Error('Invalid simulator process table');
  const result = {};
  for (const line of output.split('\n')) {
    const match = /^\s*([1-9]\d*)\s+-?\d+\s+(?:UIKitApplication:)?com\.apple\.(SpringBoard|Spotlight)(?:\[[^\s]*\])?\s*$/.exec(line);
    if (!match) continue;
    const key = match[2] === 'SpringBoard' ? 'springboard' : 'spotlight';
    if (result[key] !== undefined) throw new Error('Simulator service identity is ambiguous: ' + key);
    const pid = Number(match[1]);
    if (!Number.isSafeInteger(pid)) throw new Error('Invalid simulator process identity');
    result[key] = pid;
  }
  return result;
}

export async function resetArtworkSimulator(
  run,
  deviceId,
  { now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {},
) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('Invalid simulator UUID');
  // Reuse the original Keychain-reset budget, including all readiness probes.
  // App launch still has its separate, unchanged 60-second budget.
  const started = now();
  const deadline = started + 120000;
  const remaining = () => {
    const value = deadline - now();
    if (value <= 0) throw new Error('Simulator restart did not settle before the reset deadline');
    return value;
  };
  const processes = () =>
    simulatorServicePids(
      run('xcrun', ['simctl', 'spawn', deviceId, 'launchctl', 'list'], {
        encoding: 'utf8',
        timeout: Math.min(5000, remaining()),
      }),
    );
  const before = processes();
  if (!before.springboard) throw new Error('SpringBoard was not running before simulator reset');
  run(
    'applesimutils',
    ['--byId', deviceId, '--bundle', 'com.romanmodin.redwallet', '--clearKeychain', '--setPermissions', 'notifications=NO'],
    { encoding: 'utf8', timeout: Math.min(60000, remaining()) },
  );
  // Poll observations only: never repeat a reset, relaunch or failed command.
  // If Spotlight was running, its replacement also has to appear (the same
  // service-refresh barrier used by Appium's iOS permission-reset handling).
  for (;;) {
    remaining();
    const after = processes();
    remaining();
    if (
      after.springboard &&
      after.springboard !== before.springboard &&
      (!before.spotlight || (after.spotlight && after.spotlight !== before.spotlight))
    ) {
      return { deviceId, before, after, elapsedMs: now() - started };
    }
    await pause(Math.min(500, remaining()));
  }
}

export async function prepareArtworkApp({ device, setup, waitForReady, run }) {
  await setup('terminate-before-reset', () => device.terminateApp());
  await setup('uninstall-before-reset', () => device.uninstallApp());
  await setup('install-clean-app', () => device.installApp());
  const reset = await setup('reset-keychain-and-notifications', () => resetArtworkSimulator(run, device.id), 120000);
  await setup('launch-clean-app', () => device.launchApp({ newInstance: false }));
  await setup('initial-wallet-list', waitForReady);
  const appearance = await setup('dark-appearance', () => setSimulatorAppearance(run, device.id, 'dark'));
  await setup('wallet-list-after-appearance', waitForReady);
  return { ...appearance, reset };
}
