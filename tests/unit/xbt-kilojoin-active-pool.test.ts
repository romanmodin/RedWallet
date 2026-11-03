import { ActivePoolController } from '../../class/xbt/kilojoin/active-pool';
import type { ClientView, MixingClient } from '../../class/xbt/kilojoin/client';
import type { MixingWallet } from '../../class/xbt/kilojoin/wallet-adapter';

const wallet = { getID: () => 'wallet' } as MixingWallet;
const view = (phase: string): ClientView => ({ journal: { phase, reserved: ['coin'] } }) as ClientView;
function fixture() {
  const owner = new ActivePoolController();
  let emit!: (value: ClientView) => void;
  const client = {
    view: () => view('joined'),
    close: jest.fn(async () => {}),
  } as unknown as MixingClient;
  const join = jest.fn(async (listener: (value: ClientView) => void) => {
    emit = listener;
    listener(view('joined'));
    return client;
  });
  return { owner, client, join, emit: (v: ClientView) => emit(v) };
}
test('view subscriptions can detach without closing or losing the same client and signing state', async () => {
  const f = fixture(),
    first = jest.fn(),
    next = jest.fn();
  const detach = f.owner.subscribe(first);
  await f.owner.start(wallet, f.join);
  detach();
  f.emit(view('signed'));
  f.owner.subscribe(next);
  expect(next.mock.calls.at(-1)[0]).toEqual(
    expect.objectContaining({
      client: f.client,
      view: view('signed'),
      wallet,
      busy: false,
    }),
  );
  expect(f.client.close).not.toHaveBeenCalled();
  expect(f.join).toHaveBeenCalledTimes(1);
  await expect(f.owner.dismiss()).rejects.toThrow(/unresolved/);
});
test('a pending join survives navigation and rejects duplicate joins', async () => {
  const f = fixture();
  let finish!: (client: MixingClient) => void;
  const pending = f.owner.start(
    wallet,
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const detach = f.owner.subscribe(jest.fn());
  detach();
  expect(f.owner.snapshot()?.busy).toBe(true);
  await expect(f.owner.start(wallet, f.join)).rejects.toThrow(/existing pool/);
  finish(f.client);
  await pending;
  expect(f.owner.snapshot()?.client).toBe(f.client);
  expect(f.client.close).not.toHaveBeenCalled();
});
test('action serialization survives navigation and always clears its busy flag after failure', async () => {
  const f = fixture();
  await f.owner.start(wallet, f.join);
  let fail!: (error: Error) => void;
  const pending = f.owner.perform(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const detach = f.owner.subscribe(jest.fn());
  detach();
  await expect(f.owner.perform(async () => {})).rejects.toThrow(/pending/);
  await expect(f.owner.dismiss()).rejects.toThrow(/unresolved/);
  fail(new Error('durable write failed'));
  await expect(pending).rejects.toThrow(/durable write failed/);
  expect(f.owner.snapshot()?.busy).toBe(false);
  expect(f.owner.snapshot()?.client).toBe(f.client);
});
test.each(['aborted', 'complete'])('only an observed durable %s state permits dismissal', async phase => {
  const f = fixture();
  await f.owner.start(wallet, f.join);
  f.emit(view(phase));
  await f.owner.dismiss();
  expect(f.owner.snapshot()).toBeUndefined();
  expect(f.client.close).toHaveBeenCalledTimes(1);
});
test('failed join clears only the failed pending owner and can be retried after client cleanup', async () => {
  const f = fixture();
  await expect(
    f.owner.start(wallet, async () => {
      throw new Error('join rejected');
    }),
  ).rejects.toThrow(/join rejected/);
  expect(f.owner.snapshot()).toBeUndefined();
  await f.owner.start(wallet, f.join);
  expect(f.owner.snapshot()?.client).toBe(f.client);
});

test('one attempt may opt in, detach, and sign only its validated review while the deadline is live', async () => {
  const f = fixture();
  const approve = jest.fn(async () => {});
  const reconnectRelay = jest.fn(async () => {});
  Object.assign(f.client, { approve, reconnectRelay });
  await f.owner.start(wallet, f.join);
  const review = {
    session: { phase: 'review', deadline: 80 },
    journal: { phase: 'review', deadline: 100, commitment: 'exact' },
    review: {},
  } as ClientView;
  f.emit(review);
  await f.owner.advance(50);
  expect(approve).not.toHaveBeenCalled();
  f.owner.setAutomatic(f.client, true);
  const detach = f.owner.subscribe(jest.fn());
  detach();
  await f.owner.advance(80);
  f.emit({ ...review, error: 'invalid roster' });
  await f.owner.advance(50);
  f.emit({ ...review, error: 'disconnected', relayInterrupted: true });
  await f.owner.advance(50);
  expect(reconnectRelay).toHaveBeenCalledTimes(1);
  expect(approve).not.toHaveBeenCalled();
  f.emit(review);
  await Promise.all([f.owner.advance(51), f.owner.advance(51)]);
  expect(approve).toHaveBeenCalledTimes(1);
  expect(approve).toHaveBeenCalledWith('exact');
  f.owner.setAutomatic(f.client, false);
  await f.owner.advance(52);
  expect(approve).toHaveBeenCalledTimes(1);
});

test('authorized round requests closing once, respects a saved vote and waits for every signature before broadcasting', async () => {
  const f = fixture();
  const requestClose = jest.fn(async () => {});
  const vote = jest.fn(async () => {});
  const broadcast = jest.fn(async () => {});
  Object.assign(f.client, { terms: { min_peers: 2 }, requestClose, vote, broadcast });
  await f.owner.start(wallet, f.join);
  const seats = [{ coins: [{ txid: 'a', vout: 0 }] }, { coins: [{ txid: 'b', vout: 0 }] }];
  const open = { session: { phase: 'open', seats, signatures: {}, deadline: 80 }, journal: { phase: 'joined', deadline: 90 } };
  f.emit(open as unknown as ClientView);
  f.owner.setAutomatic(f.client, true);
  await f.owner.advance(50);
  await f.owner.advance(51);
  expect(requestClose).toHaveBeenCalledTimes(1);
  const voting = { ...open.session, phase: 'voting', voteId: 'v' };
  f.emit({ ...open, session: voting } as unknown as ClientView);
  await f.owner.advance(52);
  expect(vote).toHaveBeenCalledWith(true);
  f.emit({ ...open, session: { ...voting, closingResponse: { voteId: 'v', accept: false } } } as unknown as ClientView);
  await f.owner.advance(53);
  expect(vote).toHaveBeenCalledTimes(1);
  const signed = {
    session: { ...open.session, phase: 'signed', signatures: { 'a:0': 'sig' } },
    journal: { phase: 'signed', deadline: 90 },
  };
  f.emit(signed as unknown as ClientView);
  await f.owner.advance(54);
  expect(broadcast).not.toHaveBeenCalled();
  f.emit({ ...signed, session: { ...signed.session, signatures: { 'a:0': 'sig', 'b:0': 'sig' } } } as unknown as ClientView);
  await f.owner.advance(55);
  expect(broadcast).toHaveBeenCalledTimes(1);
});
