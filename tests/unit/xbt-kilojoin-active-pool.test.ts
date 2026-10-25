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
