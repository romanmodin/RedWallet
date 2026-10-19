import { KilojoinRelay } from '../../class/xbt/kilojoin/relay';
import { signEvent } from '../../class/xbt/kilojoin/crypto';
const secret = Buffer.from('01'.padStart(64, '0'), 'hex');
const event = signEvent({ kind: 2023, created_at: 100, tags: [], content: 'test transport payload' }, secret, Buffer.alloc(32));
function fixture(handler = jest.fn(async () => {})) {
  const socket = {
    onopen: undefined as undefined | (() => void),
    onmessage: undefined as undefined | ((event: { data: string }) => void),
    onerror: undefined as undefined | (() => void),
    onclose: undefined as undefined | (() => void),
    send: jest.fn(),
    close: jest.fn(),
  };
  const errors = jest.fn(),
    relay = new KilojoinRelay(handler, errors, () => socket as unknown as WebSocket);
  return { socket, relay, errors, handler, message: (body: unknown[]) => socket.onmessage!({ data: JSON.stringify(body) }) };
}
afterEach(() => jest.useRealTimers());
test('publishing waits for matching positive relay acknowledgment', async () => {
  const f = fixture(),
    connection = f.relay.connect();
  f.socket.onopen!();
  await connection;
  let acknowledged = false;
  const publish = f.relay.publish(event).then(() => {
    acknowledged = true;
  });
  f.message(['OK', 'wrong-id', true]);
  await Promise.resolve();
  expect(acknowledged).toBe(false);
  f.message(['OK', event.id, true]);
  await publish;
  expect(acknowledged).toBe(true);
  f.relay.close();
});
test('negative acknowledgments and disconnects reject pending publication', async () => {
  const f = fixture(),
    connection = f.relay.connect();
  f.socket.onopen!();
  await connection;
  const first = f.relay.publish(event);
  f.message(['OK', event.id, false]);
  await expect(first).rejects.toThrow('rejected');
  const second = f.relay.publish(event);
  f.relay.close();
  await expect(second).rejects.toThrow('closed');
});
test('connection and publication timeouts fail closed', async () => {
  jest.useFakeTimers();
  const f = fixture(),
    connection = f.relay.connect();
  const failed = connection.catch(error => error);
  jest.advanceTimersByTime(15000);
  expect((await failed).message).toContain('closed');
  const g = fixture(),
    connected = g.relay.connect();
  g.socket.onopen!();
  await connected;
  const pending = g.relay.publish(event).catch(error => error);
  jest.advanceTimersByTime(15000);
  expect((await pending).message).toContain('not acknowledged');
  g.relay.close();
});
test('serializes valid events and ignores wrong subscription and malformed signatures', async () => {
  let finish!: () => void;
  const handler = jest.fn(async () => {
    if (handler.mock.calls.length === 1)
      await new Promise<void>(resolve => {
        finish = resolve;
      });
  });
  const f = fixture(handler),
    connected = f.relay.connect();
  f.socket.onopen!();
  await connected;
  f.relay.subscribe([event.pubkey], [event.pubkey], 0);
  f.message(['EVENT', 'other', event]);
  f.message(['EVENT', 'kilojoin-participant-1', { ...event, content: 'changed' }]);
  f.message(['EVENT', 'kilojoin-participant-1', event]);
  f.message(['EVENT', 'kilojoin-participant-1', event]);
  await Promise.resolve();
  expect(handler).toHaveBeenCalledTimes(1);
  finish();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(handler).toHaveBeenCalledTimes(2);
  expect(f.errors).not.toHaveBeenCalled();
  f.relay.close();
});

test('queued events from a superseded subscription are not delivered after the current handler', async () => {
  let finish!: () => void;
  const handler = jest.fn(async () => {
    if (handler.mock.calls.length === 1)
      await new Promise<void>(resolve => {
        finish = resolve;
      });
  });
  const f = fixture(handler),
    connected = f.relay.connect();
  f.socket.onopen!();
  await connected;
  f.relay.subscribe([event.pubkey], [event.pubkey], 0);
  f.message(['EVENT', 'kilojoin-participant-1', event]);
  f.message(['EVENT', 'kilojoin-participant-1', event]);
  await Promise.resolve();
  f.relay.subscribe([event.pubkey], [event.pubkey], 1);
  finish();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(handler).toHaveBeenCalledTimes(1);
  f.message(['EVENT', 'kilojoin-participant-2', event]);
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(handler).toHaveBeenCalledTimes(2);
  f.relay.close();
});
