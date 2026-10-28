import { execFileSync } from 'child_process';
import { mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const bundleId = 'com.romanmodin.redwallet';

/** Only the exact simulator application is eligible; never sample a similarly named app. */
export function simulatorAppPid(list: string): number {
  const prefix = 'application.' + bundleId + '.';
  const matches = list
    .split(/\r?\n/)
    .map(line => line.trim().split(/\s+/))
    .filter(fields => {
      const label = fields[2] || '';
      const exactApp =
        label.startsWith('UIKitApplication:' + bundleId + '[') ||
        (label.startsWith(prefix) && /^[0-9]+(?:\.|$)/.test(label.slice(prefix.length)));
      return fields.length === 3 && /^[1-9][0-9]*$/.test(fields[0]) && exactApp;
    });
  if (matches.length !== 1) throw new Error('Could not identify one exact RedWallet simulator process');
  return Number(matches[0][0]);
}

/** Host-side sampling still works when Detox cannot get a response from the app. */
export function captureIosStall(simulatorId: string, directory: string): void {
  if (process.platform !== 'darwin') return;
  if (!/^[0-9a-f-]{36}$/i.test(simulatorId)) throw new Error('Invalid simulator identity');
  mkdirSync(directory, { recursive: true });
  const list = execFileSync('xcrun', ['simctl', 'spawn', simulatorId, 'launchctl', 'list'], {
    encoding: 'utf8',
    timeout: 10_000,
    stdio: 'pipe',
  });
  const pid = simulatorAppPid(list);
  writeFileSync(path.join(directory, 'ios-stall-process.json'), JSON.stringify({ simulatorId, bundleId, pid }, null, 2) + '\n');
  execFileSync('/usr/bin/sample', [String(pid), '3', '-file', path.join(directory, 'ios-stall-sample.txt')], {
    timeout: 10_000,
    stdio: 'pipe',
  });
}
