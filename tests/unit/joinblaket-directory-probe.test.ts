import { probeDirectory, DirectoryProbeError } from '../../class/joinblaket/directory-probe';
import { NickIdentity } from '../../class/joinblaket/nick';
import { fetchOrderbook } from '../../class/joinblaket/orderbook';
import type { DirectoryClient } from '../../class/joinblaket/directory';

jest.mock('../../class/joinblaket/ios-transport', () => ({ createIosDirectoryClient: jest.fn() }));
jest.mock('../../class/joinblaket/orderbook', () => ({ fetchOrderbook: jest.fn() }));

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}
async function turns() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function fixture() {
  const identity = new NickIdentity(Buffer.alloc(32, 1));
  const client = {
    authenticated: true,
    peers: new Map([['one', {}]]),
    connect: jest.fn(async (_signal: AbortSignal) => {}),
    close: jest.fn(),
  };
  const dependencies = {
    identity: jest.fn(async () => identity),
    client: jest.fn(() => client as unknown as DirectoryClient),
  };
  const controller = new AbortController();
  const stages: string[] = [];
  const run = () => probeDirectory({ signal: controller.signal, onStage: stage => stages.push(stage) }, dependencies);
  return { identity, client, dependencies, controller, stages, run };
}
beforeEach(() => {
  (fetchOrderbook as jest.Mock).mockReset().mockResolvedValue({
    offers: [{ offer: { counterparty: 'one' } }, { offer: { counterparty: 'one' } }, { offer: { counterparty: 'two' } }],
    heard: 4,
    dropped: 1,
    truncated: false,
  });
});
afterEach(() => {
  jest.useRealTimers();
});

it('returns only a detached public summary and destroys the ephemeral identity after a read-only request', async () => {
  const f = fixture();
  const result = await f.run();
  expect(result).toEqual({
    authenticated: true,
    certifiedOffers: 3,
    makers: 2,
    peers: 1,
    heard: 4,
    dropped: 1,
    chainVerified: false,
    paymentsEnabled: false,
  });
  expect(Object.isFrozen(result)).toBe(true);
  expect(f.stages).toEqual(['identity', 'authentication', 'orderbook']);
  expect(fetchOrderbook).toHaveBeenCalledTimes(1);
  expect(fetchOrderbook).toHaveBeenCalledWith(f.client, { signal: expect.any(AbortSignal) });
  expect(f.client.close).toHaveBeenCalled();
  expect(f.identity.destroyed).toBe(true);
  expect(JSON.stringify(result)).not.toContain(f.identity.nick);
});

it('does nothing when already cancelled', async () => {
  const f = fixture();
  f.controller.abort();
  await expect(f.run()).rejects.toMatchObject({ reason: 'cancelled', stage: 'identity' });
  expect(f.dependencies.identity).not.toHaveBeenCalled();
  expect(f.dependencies.client).not.toHaveBeenCalled();
  f.identity.destroy();
});

it('cancels promptly during RNG and destroys a late identity without opening the directory', async () => {
  const f = fixture(),
    pending = deferred<NickIdentity>();
  f.dependencies.identity.mockReturnValue(pending.promise);
  const running = f.run();
  f.controller.abort();
  await expect(running).rejects.toMatchObject({ reason: 'cancelled' });
  pending.resolve(f.identity);
  await turns();
  expect(f.identity.destroyed).toBe(true);
  expect(f.dependencies.client).not.toHaveBeenCalled();
});

it('bounds a stalled identity factory and cleans up its late completion', async () => {
  jest.useFakeTimers();
  const f = fixture(),
    pending = deferred<NickIdentity>();
  f.dependencies.identity.mockReturnValue(pending.promise);
  const running = f.run();
  await Promise.all([
    expect(running).rejects.toMatchObject({ reason: 'timeout', stage: 'identity' }),
    jest.advanceTimersByTimeAsync(300000),
  ]);
  pending.resolve(f.identity);
  await turns();
  expect(f.identity.destroyed).toBe(true);
  expect(f.dependencies.client).not.toHaveBeenCalled();
});

it('never reads the market when connect returns without authentication', async () => {
  const f = fixture();
  f.client.authenticated = false;
  await expect(f.run()).rejects.toMatchObject({ reason: 'failed', stage: 'authentication' });
  expect(fetchOrderbook).not.toHaveBeenCalled();
  expect(f.identity.destroyed).toBe(true);
});

it('cancels a hanging connection and never advances after it eventually resolves', async () => {
  const f = fixture(),
    pending = deferred<void>();
  f.client.connect.mockReturnValue(pending.promise);
  const running = f.run();
  await turns();
  f.controller.abort();
  await expect(running).rejects.toMatchObject({ reason: 'cancelled', stage: 'authentication' });
  expect(f.client.connect.mock.calls[0][0].aborted).toBe(true);
  expect(f.client.close).toHaveBeenCalled();
  expect(f.identity.destroyed).toBe(true);
  pending.resolve();
  await turns();
  expect(fetchOrderbook).not.toHaveBeenCalled();
});

it.each(['cancel', 'timeout'])('stops a hanging market request on %s without a late success', async method => {
  jest.useFakeTimers();
  const f = fixture(),
    pending = deferred<unknown>();
  (fetchOrderbook as jest.Mock).mockReturnValue(pending.promise);
  const running = f.run();
  await turns();
  if (method === 'cancel') f.controller.abort();
  await Promise.all([
    expect(running).rejects.toMatchObject({ reason: method === 'cancel' ? 'cancelled' : 'timeout', stage: 'orderbook' }),
    jest.advanceTimersByTimeAsync(method === 'cancel' ? 0 : 300000),
  ]);
  pending.resolve({ offers: [], heard: 0, dropped: 0, truncated: false });
  await turns();
  expect(f.identity.destroyed).toBe(true);
  expect(f.client.close).toHaveBeenCalled();
});

it('refuses truncated discovery and never represents it as a complete market', async () => {
  const f = fixture();
  (fetchOrderbook as jest.Mock).mockResolvedValue({ offers: [], heard: 1, dropped: 1, truncated: true });
  await expect(f.run()).rejects.toMatchObject({ reason: 'failed', stage: 'orderbook' });
  expect(f.identity.destroyed).toBe(true);
});

it('allows an empty authenticated market without claiming an available payment', async () => {
  const f = fixture();
  (fetchOrderbook as jest.Mock).mockResolvedValue({ offers: [], heard: 0, dropped: 0, truncated: false });
  await expect(f.run()).resolves.toMatchObject({ certifiedOffers: 0, makers: 0, chainVerified: false, paymentsEnabled: false });
});

it.each(['identity', 'client', 'connect', 'orderbook'])('cleans up and sanitizes a failure in %s', async operation => {
  const f = fixture(),
    privateError = new Error('unexpected secret from lower layer');
  if (operation === 'identity') f.dependencies.identity.mockRejectedValue(privateError);
  if (operation === 'client')
    f.dependencies.client.mockImplementation(() => {
      throw privateError;
    });
  if (operation === 'connect') f.client.connect.mockRejectedValue(privateError);
  if (operation === 'orderbook') (fetchOrderbook as jest.Mock).mockRejectedValue(privateError);
  try {
    await f.run();
    throw new Error('Expected probe failure');
  } catch (error) {
    expect(error).toBeInstanceOf(DirectoryProbeError);
    expect(String(error)).not.toContain('secret');
  }
  if (operation !== 'identity') expect(f.identity.destroyed).toBe(true);
  else f.identity.destroy();
});

it('checks cancellation caused by a progress observer before allocating the client', async () => {
  const f = fixture();
  await expect(
    probeDirectory(
      {
        signal: f.controller.signal,
        onStage: stage => {
          if (stage === 'authentication') f.controller.abort();
        },
      },
      f.dependencies,
    ),
  ).rejects.toMatchObject({ reason: 'cancelled' });
  expect(f.dependencies.client).not.toHaveBeenCalled();
  expect(f.identity.destroyed).toBe(true);
});
