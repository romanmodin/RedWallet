import {
  createIosDirectoryTransport,
  DirectoryNativeBridge,
  IOS_DIRECTORY_HOST,
  IOS_DIRECTORY_PORT,
} from '../../class/joinblaket/ios-transport';
import { randomBytes } from '../../class/rng';

jest.mock('../../class/rng', () => ({ randomBytes: jest.fn() }));

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  let rejectValue!: (reason: Error) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });
  return { promise, resolve: resolveValue, reject: rejectValue };
}
async function turns() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function fixture() {
  const joinblaket = jest.fn<Promise<unknown>, Parameters<DirectoryNativeBridge['joinblaket']>>(async () => null);
  const bridge = { joinblaket };
  const controller = new AbortController();
  const transport = createIosDirectoryTransport(bridge, 'ios');
  return { bridge, controller, transport, open: () => transport.open(IOS_DIRECTORY_HOST, IOS_DIRECTORY_PORT, controller.signal) };
}

beforeEach(() => {
  (randomBytes as jest.Mock).mockReset().mockResolvedValue(Buffer.alloc(16, 0x42));
});
afterEach(() => {
  jest.useRealTimers();
});

it('pins the destination, requires iOS/native support and performs no import-time connection', async () => {
  const f = fixture();
  expect(f.bridge.joinblaket).not.toHaveBeenCalled();
  for (const host of ['localhost', 'example.com', IOS_DIRECTORY_HOST.toUpperCase(), IOS_DIRECTORY_HOST + '.', ' ' + IOS_DIRECTORY_HOST]) {
    await expect(f.transport.open(host, IOS_DIRECTORY_PORT, f.controller.signal)).rejects.toThrow('unavailable');
  }
  await expect(f.transport.open(IOS_DIRECTORY_HOST, 443, f.controller.signal)).rejects.toThrow('unavailable');
  await expect(
    createIosDirectoryTransport(f.bridge, 'android').open(IOS_DIRECTORY_HOST, IOS_DIRECTORY_PORT, f.controller.signal),
  ).rejects.toThrow('unavailable');
  await expect(
    createIosDirectoryTransport({} as DirectoryNativeBridge, 'ios').open(IOS_DIRECTORY_HOST, IOS_DIRECTORY_PORT, f.controller.signal),
  ).rejects.toThrow('unavailable');
  expect(f.bridge.joinblaket).not.toHaveBeenCalled();
});

it('uses one opaque handle, preserves CR and asks the native writer to append LF', async () => {
  const f = fixture();
  const stream = await f.open();
  f.bridge.joinblaket.mockImplementation(async action => (action === 'read' ? 'frame\r' : null));
  expect(await stream.readLine()).toBe('frame\r');
  await stream.writeLine('frame\r');
  const id = f.bridge.joinblaket.mock.calls[0][1];
  expect(id).toMatch(/^[a-f0-9]{32}$/);
  expect(f.bridge.joinblaket).toHaveBeenCalledWith('read', id, '');
  expect(f.bridge.joinblaket).toHaveBeenCalledWith('write', id, 'frame\r');
  stream.close();
  stream.close();
  expect(f.bridge.joinblaket.mock.calls.filter(([action]) => action === 'close')).toHaveLength(1);
  await expect(stream.readLine()).rejects.toThrow('unavailable');
});

it('cancels during entropy acquisition without starting native Tor', async () => {
  const entropy = deferred<Buffer>();
  (randomBytes as jest.Mock).mockReturnValue(entropy.promise);
  const f = fixture();
  const opening = f.open();
  f.controller.abort();
  entropy.resolve(Buffer.alloc(16));
  await expect(opening).rejects.toThrow('unavailable');
  expect(f.bridge.joinblaket).not.toHaveBeenCalled();
});

it('cancels an opening connection promptly and closes a late native completion', async () => {
  const f = fixture(),
    pending = deferred<unknown>();
  f.bridge.joinblaket.mockImplementation(action => (action === 'open' ? pending.promise : Promise.resolve(null)));
  const opening = f.open();
  await turns();
  f.controller.abort();
  await expect(opening).rejects.toThrow('unavailable');
  expect(f.bridge.joinblaket.mock.calls.filter(([action]) => action === 'close')).toHaveLength(1);
  pending.resolve(null);
  await turns();
  expect(f.bridge.joinblaket.mock.calls.filter(([action]) => action === 'close')).toHaveLength(2);
});

it('bounds opening time even when the native promise never settles', async () => {
  jest.useFakeTimers();
  const f = fixture(),
    pending = deferred<unknown>();
  f.bridge.joinblaket.mockImplementation(action => (action === 'open' ? pending.promise : Promise.resolve(null)));
  const opening = f.open();
  await turns();
  await Promise.all([expect(opening).rejects.toThrow('unavailable'), jest.advanceTimersByTimeAsync(120_000)]);
  expect(f.bridge.joinblaket).toHaveBeenCalledWith('close', expect.any(String), '');
});

it('abort settles an outstanding read without depending on native callback delivery', async () => {
  const f = fixture(),
    pending = deferred<unknown>(),
    stream = await f.open();
  f.bridge.joinblaket.mockImplementation(action => (action === 'read' ? pending.promise : Promise.resolve(null)));
  const reading = stream.readLine();
  f.controller.abort();
  await expect(reading).rejects.toThrow('unavailable');
  pending.resolve('late\r');
  await turns();
});

it('rejects overlapping reads and writes without creating an unbounded queue', async () => {
  const f = fixture(),
    pendingRead = deferred<unknown>(),
    pendingWrite = deferred<unknown>(),
    stream = await f.open();
  f.bridge.joinblaket.mockImplementation(action =>
    action === 'read' ? pendingRead.promise : action === 'write' ? pendingWrite.promise : Promise.resolve(null),
  );
  const reading = stream.readLine(),
    writing = stream.writeLine('one\r');
  await expect(stream.readLine()).rejects.toThrow('already pending');
  await expect(stream.writeLine('two\r')).rejects.toThrow('already pending');
  pendingRead.resolve('reply\r');
  pendingWrite.resolve(null);
  expect(await reading).toBe('reply\r');
  await writing;
  stream.close();
});

it('bounds writes in UTF8 bytes and rejects multiple lines before the bridge', async () => {
  const f = fixture(),
    stream = await f.open();
  for (const bad of ['', 'x', 'x\n', 'x\r\n', 'x\ry\r', 'é'.repeat(32768) + '\r']) {
    await expect(stream.writeLine(bad)).rejects.toThrow('Invalid directory line');
  }
  expect(f.bridge.joinblaket.mock.calls.filter(([action]) => action === 'write')).toHaveLength(0);
  await stream.writeLine('x'.repeat(65534) + '\r');
  stream.close();
});

it.each([{}, undefined, 'a\nb', 'é'.repeat(32768)])('closes on malformed or oversized native reads (%#)', async value => {
  const f = fixture(),
    stream = await f.open();
  f.bridge.joinblaket.mockResolvedValue(value);
  await expect(stream.readLine()).rejects.toThrow('unavailable');
  expect(f.bridge.joinblaket).toHaveBeenCalledWith('close', expect.any(String), '');
});

it('closes on EOF and sanitizes native errors', async () => {
  const f = fixture(),
    stream = await f.open();
  expect(await stream.readLine()).toBeNull();
  const g = fixture();
  g.bridge.joinblaket.mockRejectedValue(new Error('private native detail'));
  await expect(g.open()).rejects.toThrow(/^JoinBlaket Tor connection unavailable$/);
  expect(g.bridge.joinblaket).toHaveBeenCalledWith('close', expect.any(String), '');
});

it('also cleans up synchronous bridge failures', async () => {
  const f = fixture();
  f.bridge.joinblaket.mockImplementation(() => {
    throw new Error('native detail');
  });
  await expect(f.open()).rejects.toThrow(/^JoinBlaket Tor connection unavailable$/);
  expect(f.bridge.joinblaket).toHaveBeenCalledWith('close', expect.any(String), '');
});
