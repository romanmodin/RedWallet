import { spawnSync } from 'child_process';
import path from 'path';
import { lifecycleFormats } from '../native/lifecycle-formats';
import { lifecycleCaseTimeoutMs } from '../native/lifecycle-timeouts';

test('unfiltered lifecycle retains both formats', () => {
  expect(lifecycleFormats()).toEqual(['segwit', 'taproot']);
});

test.each(['segwit', 'taproot'] as const)('isolated %s process executes only its selected format', format => {
  expect(lifecycleFormats(format)).toEqual([format]);
});

test.each(['', 'unknown', 'segwit,taproot'])('invalid format %j fails before native execution', format => {
  expect(() => lifecycleFormats(format)).toThrow('Invalid native lifecycle format');
});

test('only deletion receives the evidence-backed extended case bound', () => {
  expect(lifecycleCaseTimeoutMs('delete')).toBe(18 * 60 * 1000);
});

test.each(['recovery', 'receive', 'send', 'rbf', 'cpfp', 'encryption', 'final'])('%s retains the default case bound', stage =>
  expect(lifecycleCaseTimeoutMs(stage)).toBe(15 * 60 * 1000),
);

test('iOS runner executes both formats once and prevents failed or timed-out child processes from overlapping', () => {
  const scriptDirectory = path.resolve(__dirname, '../../.github/scripts');
  const result = spawnSync(
    'python3',
    [path.join(scriptDirectory, 'tests/test_native_ios_stage_runner.py'), path.join(scriptDirectory, 'run-native-ios-stage.py')],
    { encoding: 'utf8', timeout: 15000 },
  );
  expect(result.error).toBeUndefined();
  expect(result.stderr).toContain('Ran 5 tests');
  expect(result.stderr).toContain('OK');
  expect(result.status).toBe(0);
});
