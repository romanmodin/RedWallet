import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const runner = path.resolve(__dirname, '../../.github/scripts/run-native-android-stage.sh');
let fixture;

function executable(name, script) {
  fs.writeFileSync(path.join(fixture, name), '#!/usr/bin/env bash\n' + script, { mode: 0o755 });
}

beforeEach(() => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'redwallet-artifact-preflight-'));
  executable(
    'adb',
    [
      'echo "adb $*" >> "$PROBE_TRACE"',
      'if [ "$2" = logcat ]; then',
      '  count=0',
      '  if [ -f "$PROBE_COUNT" ]; then read -r count < "$PROBE_COUNT"; fi',
      '  count=$((count + 1))',
      '  echo "$count" > "$PROBE_COUNT"',
      '  if [ "$count" -le "$PROBE_LOG_FAILURES" ]; then exit 1; fi',
      'fi',
      'if [ "$2" = screenrecord ] && [ "$PROBE_VIDEO_FAILURE" = 1 ]; then exit 1; fi',
      'exit 0',
    ].join('\n'),
  );
  executable('sleep', 'exit 0\n');
  executable('timeout', 'echo "timeout $1 $2" >> "$PROBE_TRACE"\nshift 2\nexec "$@"\n');
  executable('npx', 'echo "detox $*" >> "$PROBE_TRACE"\nexit "$DETOX_EXIT"\n');
});

afterEach(() => {
  fs.rmSync(fixture, { recursive: true, force: true });
});

function run(overrides = {}) {
  const result = spawnSync('bash', [runner], {
    encoding: 'utf8',
    timeout: 10000,
    env: {
      ...process.env,
      PATH: fixture + path.delimiter + process.env.PATH,
      RUNNER_TEMP: fixture,
      PROBE_TRACE: path.join(fixture, 'trace'),
      PROBE_COUNT: path.join(fixture, 'count'),
      PROBE_LOG_FAILURES: '0',
      PROBE_VIDEO_FAILURE: '0',
      DETOX_EXIT: '0',
      ...overrides,
    },
  });
  expect(result.error).toBeUndefined();
  return { ...result, trace: fs.readFileSync(path.join(fixture, 'trace'), 'utf8') };
}

test('starts Detox once only after both recorders and files are ready, preserving its exit status', () => {
  const result = run({ DETOX_EXIT: '7' });
  expect(result.status).toBe(7);
  expect(result.trace.match(/^detox /gm)).toHaveLength(1);
  const launch = result.trace.indexOf('detox ');
  for (const operation of [
    'adb shell logcat -d -f /sdcard/redwallet-detox-probe.log',
    'adb shell screenrecord --time-limit 1 /sdcard/redwallet-detox-probe.mp4',
    'adb shell test -e /sdcard/redwallet-detox-probe.log',
    'adb shell test -e /sdcard/redwallet-detox-probe.mp4',
  ]) {
    expect(result.trace.indexOf(operation)).toBeGreaterThanOrEqual(0);
    expect(result.trace.indexOf(operation)).toBeLessThan(launch);
  }
  expect(result.trace).toContain('--record-videos failing --record-logs failing --take-screenshots failing');
  expect(result.trace).toContain('--retries 0');
  expect(result.trace.match(/^timeout --kill-after=1s 5s$/gm)).toHaveLength(result.trace.match(/^adb /gm).length);
});

test('retries transient recorder readiness without retrying Detox', () => {
  const result = run({ PROBE_LOG_FAILURES: '2' });
  expect(result.status).toBe(0);
  expect(result.trace.match(/adb shell logcat/g)).toHaveLength(3);
  expect(result.trace.match(/^detox /gm)).toHaveLength(1);
});

test('persistent log recording failure stops after thirty probes without starting the wallet test', () => {
  const result = run({ PROBE_LOG_FAILURES: '99' });
  expect(result.status).toBe(1);
  expect(result.trace.match(/adb shell logcat/g)).toHaveLength(30);
  expect(result.trace).not.toContain('detox ');
});

test('working logs cannot bypass a persistently unavailable video recorder', () => {
  const result = run({ PROBE_VIDEO_FAILURE: '1' });
  expect(result.status).toBe(1);
  expect(result.trace.match(/adb shell screenrecord/g)).toHaveLength(30);
  expect(result.trace).not.toContain('detox ');
});
