import { findLndPayment, LndPaymentTracker, lndPaymentMessage } from '../../blue_modules/lnd-payment-status';

const hash = 'a'.repeat(64);
const other = 'b'.repeat(64);
const empty = () => ({ rows: [], next: '0', more: false });
const row = (state: string, id = hash) => ({ id, direction: 'sent', state });
const page = (state: string) => ({ rows: [row(state)], next: '1', more: false });

test('a lost send response is reconciled as settled without sending again', async () => {
  const read = jest.fn().mockResolvedValueOnce(empty()).mockResolvedValue(page('settled'));
  const send = jest.fn().mockRejectedValue(new Error('response interrupted'));
  const tracker = new LndPaymentTracker(read);
  expect(await tracker.submit(hash, send)).toEqual({ state: 'settled' });
  expect(await tracker.submit(hash, send)).toEqual({ state: 'settled', alreadyPaid: true });
  expect(send).toHaveBeenCalledTimes(1);
});

test.each(['pending', 'settled', 'unknown'])('a recorded %s invoice cannot trigger a new payment', async state => {
  const tracker = new LndPaymentTracker(jest.fn().mockResolvedValue(page(state)));
  const send = jest.fn();
  expect((await tracker.submit(hash, send)).state).toBe(state);
  expect(send).not.toHaveBeenCalled();
});

test('unknown with no history remains blocked, including after another invoice and case changes', async () => {
  const tracker = new LndPaymentTracker(jest.fn().mockResolvedValue(empty()));
  const send = jest.fn().mockRejectedValue(new Error('connection lost'));
  expect((await tracker.submit(hash, send)).state).toBe('unknown');
  expect((await tracker.submit(other, jest.fn().mockResolvedValue(true))).state).toBe('settled');
  expect((await tracker.submit(hash.toUpperCase(), send)).state).toBe('unknown');
  expect(send).toHaveBeenCalledTimes(1);
});

test('two rapid confirmations share one status lookup and one submission', async () => {
  let complete!: (value: unknown) => void;
  const read = jest.fn().mockImplementation(
    () =>
      new Promise(resolve => {
        complete = resolve;
      }),
  );
  const send = jest.fn().mockResolvedValue(true);
  const tracker = new LndPaymentTracker(read);
  const first = tracker.submit(hash, send);
  const second = tracker.submit(hash.toUpperCase(), send);
  expect(second).toBe(first);
  complete(empty());
  expect(await first).toEqual({ state: 'settled' });
  expect(send).toHaveBeenCalledTimes(1);
});

test('a failed payment permits another explicitly requested submission, without automatic retry', async () => {
  const read = jest.fn().mockResolvedValueOnce(empty()).mockResolvedValue(page('failed'));
  const send = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  const tracker = new LndPaymentTracker(read);
  expect((await tracker.submit(hash, send)).state).toBe('failed');
  expect(send).toHaveBeenCalledTimes(1);
  expect((await tracker.submit(hash, send)).state).toBe('settled');
  expect(send).toHaveBeenCalledTimes(2);
});

test('a status read error before submission cannot send funds', async () => {
  const tracker = new LndPaymentTracker(jest.fn().mockRejectedValue(new Error('offline')));
  const send = jest.fn();
  expect(await tracker.submit(hash, send)).toEqual({ state: 'not_submitted', reason: 'history_unavailable' });
  expect(send).not.toHaveBeenCalled();
});

test('a status read error after submission cannot release the unknown-payment guard', async () => {
  const read = jest.fn().mockResolvedValueOnce(empty()).mockRejectedValueOnce(new Error('offline')).mockResolvedValue(empty());
  const send = jest.fn().mockRejectedValue(new Error('timeout'));
  const tracker = new LndPaymentTracker(read);
  expect((await tracker.submit(hash, send)).state).toBe('unknown');
  expect((await tracker.submit(hash, send)).state).toBe('unknown');
  expect(send).toHaveBeenCalledTimes(1);
});

test('typed pre-send validation failures are shown as not submitted and allow a fresh explicit review', async () => {
  const read = jest.fn().mockResolvedValue(empty());
  const send = jest
    .fn()
    .mockRejectedValueOnce({ code: 'payment_not_submitted_not_synced', message: 'opaque native detail' })
    .mockResolvedValueOnce(true);
  const tracker = new LndPaymentTracker(read);
  const result = await tracker.submit(hash, send);
  expect(result).toEqual({ state: 'not_submitted', reason: 'not_synced' });
  expect(lndPaymentMessage(result)).toContain('Wait for the XBT chain');
  expect(read).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledTimes(1);
  expect((await tracker.submit(hash, send)).state).toBe('settled');
});

test('payment lookup follows reversed pagination beyond the newest 100 records', async () => {
  const read = jest
    .fn()
    .mockResolvedValueOnce({
      rows: Array.from({ length: 100 }, (_, i) => row('settled', i.toString(16).padStart(64, '0'))),
      next: '101',
      more: true,
    })
    .mockResolvedValueOnce({ ...page('settled'), next: '1' });
  expect(await findLndPayment(read, hash)).toBe('settled');
  expect(read.mock.calls).toEqual([['0'], ['101']]);
});

test.each([
  { rows: [], next: '100', more: true },
  { rows: [row('failed')], next: '0', more: true },
  { rows: [{ id: hash, direction: 'received', state: 'settled' }], next: '0', more: false },
  { rows: [row('unpaid')], next: '0', more: false },
])('malformed history cannot authorize a payment: %j', async bad => {
  const send = jest.fn();
  const tracker = new LndPaymentTracker(jest.fn().mockResolvedValue(bad));
  expect((await tracker.submit(hash, send)).state).toBe('not_submitted');
  expect(send).not.toHaveBeenCalled();
});

test('a non-decreasing pagination cursor fails closed', async () => {
  const read = jest.fn().mockResolvedValue({ rows: [row('failed', other)], next: '100', more: true });
  await expect(findLndPayment(read, hash)).rejects.toThrow('Could not verify');
  expect(read).toHaveBeenCalledTimes(2);
});

test('a failed duplicate row never overrides a pending or settled record', async () => {
  for (const state of ['pending', 'settled', 'unknown'] as const) {
    const read = jest.fn().mockResolvedValue({ rows: [row('failed'), row(state)], next: '0', more: false });
    expect(await findLndPayment(read, hash)).toBe(state);
  }
});

test('status results and messages contain no native preimages or opaque error details', async () => {
  const tracker = new LndPaymentTracker(
    jest
      .fn()
      .mockResolvedValueOnce(empty())
      .mockResolvedValueOnce({ rows: [{ ...row('settled'), payment_preimage: 'private-fixture-value' }], more: false, next: '0' }),
  );
  const result = await tracker.submit(hash, jest.fn().mockRejectedValue(new Error('private-fixture-value')));
  expect(JSON.stringify(result) + lndPaymentMessage(result)).not.toContain('private-fixture-value');
});

test('a malformed native send reply must be reconciled, not treated as success', async () => {
  const tracker = new LndPaymentTracker(jest.fn().mockResolvedValueOnce(empty()).mockResolvedValue(page('pending')));
  const send = jest.fn().mockResolvedValue('completed');
  expect((await tracker.submit(hash, send)).state).toBe('pending');
  expect(send).toHaveBeenCalledTimes(1);
});
