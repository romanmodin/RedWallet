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

export const RESET_BASELINE_MS = 45000;
export const RESET_SETTLE_MS = 120000;
// Baseline + reset command + settle window, for callers' outer stage timeout.
export const RESET_STAGE_TIMEOUT_MS = RESET_BASELINE_MS + 60000 + RESET_SETTLE_MS;

export async function resetArtworkSimulator(
  run,
  deviceId,
  { now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), permissions = { notifications: 'NO' } } = {},
) {
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deviceId)) throw new Error('Invalid simulator UUID');
  // Wallet tests retain their existing permission choices. Apply them in the
  // same reset, never through a second launch-time SpringBoard restart.
  if (!permissions || typeof permissions !== 'object' || Array.isArray(permissions)) throw new Error('Invalid simulator permissions');
  const permissionEntries = Object.entries(permissions);
  for (const [key, value] of permissionEntries) {
    if (!['notifications', 'camera'].includes(key) || !['YES', 'NO'].includes(value)) throw new Error('Invalid simulator permissions');
  }
  const permissionArgs = permissionEntries.length
    ? ['--setPermissions', permissionEntries.map(([key, value]) => key + '=' + value).join(',')]
    : [];
  // Two bounded observation windows. The baseline must not consume the
  // post-reset wait: in job 137017047939 two timed-out "before" probes used ~34 s
  // of one shared 120 s budget, and Spotlight's replacement was still absent when
  // it expired. The reset is issued once; only read-only observations are
  // resampled. App launch keeps its separate, unchanged 60-second budget.
  const started = now();
  let deadline = started + RESET_BASELINE_MS;
  let phase = 'baseline';
  const observationTimeouts = [];
  let before = null;
  let lastAfter = null;
  const remaining = () => {
    const value = deadline - now();
    if (value <= 0) {
      throw new Error(
        'Simulator restart did not settle before the reset deadline: ' +
          JSON.stringify({
            deviceId,
            phase,
            before,
            lastAfter,
            observationTimeouts,
            elapsedMs: now() - started,
          }),
      );
    }
    return value;
  };
  const processes = () =>
    simulatorServicePids(
      run('xcrun', ['simctl', 'spawn', deviceId, 'launchctl', 'list'], {
        encoding: 'utf8',
        // A five-second simctl transport deadline repeatedly interrupted a
        // replacement-shell query in 42824559949 attempt 2. Allow one query to
        // settle, still inside the unchanged 120-second total reset budget.
        timeout: Math.min(15000, remaining()),
      }),
    );
  const observe = async stage => {
    for (;;) {
      remaining();
      try {
        const result = processes();
        if (stage === 'after') lastAfter = result;
        remaining(); // A late subprocess result is not readiness within our deadline.
        return result;
      } catch (error) {
        // simctl's read-only transport can stall during system-shell startup.
        // A timeout supplies NO process identity. Resample only this observation,
        // within the same total budget; never retry a reset or malformed table.
        if (error?.code !== 'ETIMEDOUT') throw error;
        observationTimeouts.push({ stage, elapsedMs: now() - started });
      }
      await pause(Math.min(500, remaining()));
    }
  };
  before = await observe('before');
  if (!before.springboard) throw new Error('SpringBoard was not running before simulator reset');
  run('applesimutils', ['--byId', deviceId, '--bundle', 'com.romanmodin.redwallet', '--clearKeychain', ...permissionArgs], {
    encoding: 'utf8',
    timeout: 60000,
  });
  // The settle window starts when the single reset returns, so a slow baseline
  // cannot starve the replacement-service observation.
  phase = 'settle';
  deadline = now() + RESET_SETTLE_MS;
  // Poll observations only: never repeat a reset or relaunch. Positive evidence
  // is required: a NEW SpringBoard PID and, if Spotlight was running before, a NEW
  // Spotlight PID (the service-refresh barrier used by Appium's iOS permission
  // reset). A late Spotlight is waited for; a stale, missing or unparseable
  // sample is never accepted.
  for (;;) {
    const after = await observe('after');
    if (
      after.springboard &&
      after.springboard !== before.springboard &&
      (!before.spotlight || (after.spotlight && after.spotlight !== before.spotlight))
    ) {
      return {
        deviceId,
        before,
        after,
        observationTimeouts,
        elapsedMs: now() - started,
      };
    }
    await pause(Math.min(500, remaining()));
  }
}

export async function prepareArtworkApp({ device, setup, waitForReady, run }) {
  await setup('terminate-before-reset', () => device.terminateApp());
  await setup('uninstall-before-reset', () => device.uninstallApp());
  await setup('install-clean-app', () => device.installApp());
  const reset = await setup('reset-keychain-and-notifications', () => resetArtworkSimulator(run, device.id), RESET_STAGE_TIMEOUT_MS);
  await setup('launch-clean-app', () => device.launchApp({ newInstance: false }));
  await setup('initial-wallet-list', waitForReady);
  const appearance = await setup('dark-appearance', () => setSimulatorAppearance(run, device.id, 'dark'));
  await setup('wallet-list-after-appearance', waitForReady);
  return { ...appearance, reset };
}
