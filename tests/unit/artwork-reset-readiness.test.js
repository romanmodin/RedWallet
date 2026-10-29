import { prepareArtworkApp, resetArtworkSimulator, simulatorServicePids } from '../e2e/artwork-setup';

const id = 'A00461C1-53DC-43E1-8399-D43CB4D3E301';
const table = (springboard = 100, spotlight = 200) =>
  'PID\tStatus\tLabel\n' +
  (springboard ? springboard + '\t0\tcom.apple.SpringBoard\n' : '-\t0\tcom.apple.SpringBoard\n') +
  (spotlight ? spotlight + '\t0\tUIKitApplication:com.apple.Spotlight[abcd][rb-legacy]\n' : '') +
  '999\t0\tcom.example.SpringBoard\n';
const makeDevice = () => ({
  id,
  terminateApp: jest.fn(),
  uninstallApp: jest.fn(),
  installApp: jest.fn(),
  clearKeychain: jest.fn(),
  launchApp: jest.fn(),
});
const clock = () => {
  let time = 0;
  return {
    now: () => time,
    pause: jest.fn(async ms => {
      time += ms;
    }),
    advance: ms => {
      time += ms;
    },
  };
};

test('artwork setup combines both resets once and observes new services before one launch', async () => {
  const device = makeDevice();
  const stages = [];
  let reads = 0;
  const run = jest.fn((command, args) => {
    if (command === 'applesimutils') return '';
    if (args.includes('launchctl')) return reads++ === 0 ? table() : table(101, 201);
    return 'dark\n';
  });
  const ready = jest.fn();
  await prepareArtworkApp({
    device,
    run,
    waitForReady: ready,
    setup: async (name, action, timeout = 60000) => {
      stages.push([name, timeout]);
      return action();
    },
  });
  const resets = run.mock.calls.filter(([command]) => command === 'applesimutils');
  expect(resets).toHaveLength(1);
  expect(resets[0][1]).toEqual([
    '--byId',
    id,
    '--bundle',
    'com.romanmodin.redwallet',
    '--clearKeychain',
    '--setPermissions',
    'notifications=NO',
  ]);
  expect(device.clearKeychain).not.toHaveBeenCalled();
  expect(reads).toBeGreaterThanOrEqual(2);
  expect(device.launchApp).toHaveBeenCalledTimes(1);
  expect(device.launchApp).toHaveBeenCalledWith({ newInstance: false });
  expect(ready).toHaveBeenCalledTimes(2);
  expect(stages).toContainEqual(['reset-keychain-and-notifications', 120000]);
  expect(stages).toContainEqual(['launch-clean-app', 60000]);
});

test('failed combined reset stops before launch, appearance and wallet readiness', async () => {
  const device = makeDevice();
  const ready = jest.fn();
  const error = new Error('reset failed');
  const run = jest.fn((command, args) => {
    if (command === 'applesimutils') throw error;
    if (args.includes('launchctl')) return table();
    throw new Error('unexpected appearance command');
  });
  await expect(
    prepareArtworkApp({
      device,
      run,
      waitForReady: ready,
      setup: (_name, action) => action(),
    }),
  ).rejects.toBe(error);
  expect(device.launchApp).not.toHaveBeenCalled();
  expect(ready).not.toHaveBeenCalled();
  expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
});

test('parser ignores stopped and lookalike services and accepts native application labels', () => {
  expect(simulatorServicePids(table())).toEqual({
    springboard: 100,
    spotlight: 200,
  });
  expect(simulatorServicePids(table(0, 0))).toEqual({});
  expect(() => simulatorServicePids('not a process table')).toThrow('process table');
  expect(() => simulatorServicePids(table() + '101\t0\tcom.apple.SpringBoard\n')).toThrow('ambiguous');
});

test('same PID and only partially restarted services never satisfy readiness', async () => {
  const ticks = clock();
  const snapshots = [table(), table(), table(101, 200), table(101, 201)];
  const run = jest.fn(command => (command === 'applesimutils' ? '' : snapshots.shift()));
  const receipt = await resetArtworkSimulator(run, id, ticks);
  expect(receipt.before).toEqual({ springboard: 100, spotlight: 200 });
  expect(receipt.after).toEqual({ springboard: 101, spotlight: 201 });
  expect(ticks.pause).toHaveBeenCalledTimes(2);
  expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
});

test('an absent optional Spotlight does not prevent observing a real SpringBoard replacement', async () => {
  const ticks = clock();
  const snapshots = [table(100, 0), table(101, 0)];
  const run = jest.fn(command => (command === 'applesimutils' ? '' : snapshots.shift()));
  const receipt = await resetArtworkSimulator(run, id, ticks);
  expect(receipt.after.springboard).toBe(101);
  expect(receipt.after.spotlight).toBeUndefined();
});

test('missing initial SpringBoard fails before modifying simulator state', async () => {
  const run = jest.fn(() => table(0, 0));
  await expect(resetArtworkSimulator(run, id, clock())).rejects.toThrow('SpringBoard');
  expect(run).toHaveBeenCalledTimes(1);
});

test('service polling expires inside the existing reset budget and never reissues reset', async () => {
  const ticks = clock();
  const run = jest.fn(command => (command === 'applesimutils' ? '' : table()));
  await expect(resetArtworkSimulator(run, id, ticks)).rejects.toThrow('restart did not settle');
  expect(ticks.now()).toBe(120000);
  expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
});

test('time spent in the reset reduces the remaining readiness budget', async () => {
  const ticks = clock();
  const run = jest.fn(command => {
    if (command === 'applesimutils') ticks.advance(119500);
    return table();
  });
  await expect(resetArtworkSimulator(run, id, ticks)).rejects.toThrow('restart did not settle');
  expect(ticks.now()).toBe(120000);
  expect(ticks.pause).toHaveBeenCalledTimes(1);
});

test('process-query errors fail closed without retrying the reset or accepting stale state', async () => {
  const error = new Error('simulator unavailable');
  let count = 0;
  const run = jest.fn(command => {
    if (command === 'applesimutils') return '';
    if (count++ === 0) return table();
    throw error;
  });
  await expect(resetArtworkSimulator(run, id, clock())).rejects.toBe(error);
  expect(run.mock.calls.filter(([command]) => command === 'applesimutils')).toHaveLength(1);
});

test.each(['', 'booted', 'another-device'])('invalid target %s never runs native commands', async invalid => {
  const run = jest.fn();
  await expect(resetArtworkSimulator(run, invalid, clock())).rejects.toThrow('UUID');
  expect(run).not.toHaveBeenCalled();
});

test('all probes target the exact simulator and every subprocess has a bounded timeout', async () => {
  const snapshots = [table(), table(101, 201)];
  const run = jest.fn(command => (command === 'applesimutils' ? '' : snapshots.shift()));
  await resetArtworkSimulator(run, id, clock());
  for (const [command, args, options] of run.mock.calls) {
    expect(options.encoding).toBe('utf8');
    expect(options.timeout).toBeGreaterThan(0);
    expect(options.timeout).toBeLessThanOrEqual(command === 'applesimutils' ? 60000 : 5000);
    if (command === 'xcrun') expect(args).toEqual(['simctl', 'spawn', id, 'launchctl', 'list']);
  }
});
