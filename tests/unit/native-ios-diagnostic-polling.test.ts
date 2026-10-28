import { execFileSync } from 'child_process';
import path from 'path';

const composeSession = require(path.join(process.cwd(), 'node_modules/detox/src/configuration/composeSessionConfig'));
const Client = require(path.join(process.cwd(), 'node_modules/detox/src/client/Client'));

async function queryCount(debugSynchronization?: number): Promise<number> {
  const config = await composeSession({
    cliConfig: debugSynchronization === undefined ? {} : { debugSynchronization },
    globalConfig: {},
    localConfig: {},
    errorComposer: {},
  });
  const client = {
    _slowInvocationTimeout: config.debugSynchronization,
    _slowInvocationStatusHandle: null as ReturnType<typeof setTimeout> | null,
    _isCleaningUp: false,
    currentStatus: jest.fn().mockResolvedValue({}),
    _scheduleSlowInvocationQuery() {
      Client.prototype._scheduleSlowInvocationQuery.call(client);
    },
  };
  client._scheduleSlowInvocationQuery();
  await jest.advanceTimersByTimeAsync(31_000);
  Client.prototype._unscheduleSlowInvocationQuery.call(client);
  return client.currentStatus.mock.calls.length;
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('the pinned Detox default actually makes repeated native diagnostic requests', async () => {
  expect(await queryCount()).toBe(3);
});

test('the real funded runner config prevents the diagnostic query that can deadlock DetoxSync', async () => {
  const script = [
    'import importlib.util,json,pathlib',
    'p=pathlib.Path(".github/scripts/run-native-ios-stage.py")',
    'spec=importlib.util.spec_from_file_location("native_runner",p)',
    'module=importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(module)',
    'print(json.dumps(module.detox_command("segwit")))',
  ].join(';');
  const args: string[] = JSON.parse(execFileSync('python3', ['-B', '-c', script], { encoding: 'utf8' }));
  const flag = args.indexOf('--debug-synchronization');
  expect(flag).toBeGreaterThan(0);
  expect(await queryCount(Number(args[flag + 1]))).toBe(0);
  // The diagnostics workaround must not silently enable automatic case retries.
  expect(args[args.indexOf('--retries') + 1]).toBe('0');
  expect(args).toContain('tests/e2e/native-live-lifecycle.spec.ts');
});
