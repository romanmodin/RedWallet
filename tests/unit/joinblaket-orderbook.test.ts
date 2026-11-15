import { fetchOrderbook } from '../../class/joinblaket/orderbook';
import { Frame, PRIVMSG, PUBMSG } from '../../class/joinblaket/wire';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const v = vectors.offer;
const offer = (): Frame => ({ type: PRIVMSG, line: v.privmsg_line });
function fixture(frames: Frame[] = []) {
  let clock = 0;
  const client = {
    authenticated: true,
    nick: v.taker_nick,
    getPeerlist: jest.fn(async () => null),
    sendPublic: jest.fn(async (_message: string) => {}),
    receive: jest.fn(async (wait: number): Promise<Frame | null> => {
      clock += frames.length ? 1 : wait;
      return frames.shift() ?? null;
    }),
    close: jest.fn(() => {
      client.authenticated = false;
    }),
  };
  return { client, options: { minWaitMs: 10, quietMs: 5, maxWaitMs: 30, now: () => clock }, elapsed: () => clock };
}

it('sends only peer discovery and one correctly framed orderbook request, then verifies certificates', async () => {
  const f = fixture([offer()]);
  const result = await fetchOrderbook(f.client, f.options);
  expect(f.client.getPeerlist).toHaveBeenCalledTimes(1);
  expect(f.client.sendPublic).toHaveBeenCalledTimes(1);
  expect(f.client.sendPublic).toHaveBeenCalledWith('orderbook');
  expect(result).toMatchObject({ heard: 1, dropped: 0, truncated: false });
  expect(result.offers[0].bond.verify(v.maker_nick, v.taker_nick)).toBe(true);
  expect(f.elapsed()).toBe(10);
  expect(f.client.close).not.toHaveBeenCalled();
});

it('rejects tampered/other-recipient offers and deduplicates repeats', async () => {
  const f = fixture([
    offer(),
    offer(),
    { ...offer(), line: v.privmsg_line.replace('2500000000', '2500000001') },
    { ...offer(), line: v.privmsg_line.replace(v.taker_nick + '!', v.maker_nick + '!') },
    { type: PUBMSG, line: 'unrelated' },
  ]);
  const result = await fetchOrderbook(f.client, f.options);
  expect(result.offers).toHaveLength(1);
  expect(result.heard).toBe(4);
  expect(result.dropped).toBe(3);
});

it('waits at least the minimum when quiet and never exceeds the absolute offer-wait deadline', async () => {
  const empty = fixture();
  await fetchOrderbook(empty.client, empty.options);
  expect(empty.elapsed()).toBe(10);
  const busy = fixture(Array.from({ length: 100 }, offer));
  await fetchOrderbook(busy.client, busy.options);
  expect(busy.elapsed()).toBe(30);
});

it('clamps minimum/quiet into the maximum and preserves zero-quiet max-wait behavior', async () => {
  const f = fixture();
  await fetchOrderbook(f.client, { ...f.options, minWaitMs: 100, maxWaitMs: 7 });
  expect(f.elapsed()).toBe(7);
  const g = fixture();
  await fetchOrderbook(g.client, { ...g.options, quietMs: 0 });
  expect(g.elapsed()).toBe(30);
});

it('labels partial results when message or byte budgets are reached', async () => {
  const f = fixture([offer(), offer(), offer()]);
  expect(await fetchOrderbook(f.client, { ...f.options, maxMessages: 1 })).toMatchObject({ heard: 1, truncated: true });
  const g = fixture([offer()]);
  expect(await fetchOrderbook(g.client, { ...g.options, maxBytes: 10 })).toMatchObject({ heard: 0, truncated: true, offers: [] });
});

it('validates options and authentication before making requests', async () => {
  const f = fixture();
  for (const options of [{ maxWaitMs: 0 }, { quietMs: -1 }, { maxMessages: 10001 }, { maxBytes: 33 * 1024 * 1024 }]) {
    await expect(fetchOrderbook(f.client, options)).rejects.toThrow('limit');
  }
  f.client.authenticated = false;
  await expect(fetchOrderbook(f.client)).rejects.toThrow('Authenticated');
  expect(f.client.getPeerlist).not.toHaveBeenCalled();
});

it('cancels before disclosure and leaves the identity/keys entirely outside this API', async () => {
  const f = fixture(),
    abort = new AbortController();
  abort.abort();
  await expect(fetchOrderbook(f.client, { ...f.options, signal: abort.signal })).rejects.toThrow('cancelled');
  expect(f.client.getPeerlist).not.toHaveBeenCalled();
  expect(f.client.sendPublic).not.toHaveBeenCalled();
  expect(f.client.close).toHaveBeenCalled();
});

it('allows one collection per client and cleans up a mid-receive cancellation', async () => {
  const f = fixture(),
    abort = new AbortController();
  let release!: (value: Frame | null) => void;
  f.client.receive.mockImplementation(
    () =>
      new Promise(resolve => {
        release = resolve;
      }),
  );
  const fetching = fetchOrderbook(f.client, { ...f.options, signal: abort.signal });
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await expect(fetchOrderbook(f.client, f.options)).rejects.toThrow('already active');
  abort.abort();
  release(null);
  await expect(fetching).rejects.toThrow('cancelled');
  expect(f.client.close).toHaveBeenCalled();
});

it('sanitizes transport failures and drops the connection', async () => {
  const f = fixture();
  f.client.getPeerlist.mockRejectedValue(new Error('private transport detail'));
  await expect(fetchOrderbook(f.client, f.options)).rejects.toThrow(/^Could not read the authenticated orderbook$/);
  expect(f.client.close).toHaveBeenCalled();
});

it('yields to cancellation events while processing a continuously queued feed', async () => {
  const f = fixture(Array.from({ length: 100 }, () => ({ type: PUBMSG, line: 'unrelated' }))),
    abort = new AbortController();
  setTimeout(() => abort.abort(), 0);
  await expect(fetchOrderbook(f.client, { ...f.options, minWaitMs: 0, quietMs: 0, maxWaitMs: 1000, signal: abort.signal })).rejects.toThrow(
    'cancelled',
  );
  expect(f.client.receive.mock.calls.length).toBeLessThanOrEqual(32);
});
