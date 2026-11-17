import { buildPayment } from '../../class/joinblaket/transaction';
import { address, networks } from 'bitcoinjs-lib';
import {
  assertPaymentMatchesPlan,
  approveInitialPlan,
  prepareInitialPlan,
  takeApprovedPlan,
  PlanRequest,
} from '../../class/joinblaket/initial-plan';
import { parseOrderbook } from '../../class/joinblaket/offers';
import { PRIVMSG } from '../../class/joinblaket/wire';
import { Selection } from '../../class/joinblaket/selection';
import { miningFee, TAKER_DUST } from '../../class/joinblaket/fees';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const addr = (byte: string) => address.fromOutputScript(Buffer.from('0014' + byte.repeat(20), 'hex'), networks.bitcoin);
const tip = vectors.offer.block_height_for_cert;
function fixture() {
  const coin = (byte: string, value: number, height = tip - 4) => ({
    txid: byte.repeat(32),
    vout: 0,
    value,
    height,
    frozen: false,
    reserved: false,
    scriptPubKey: '0014' + byte.repeat(20),
  });
  const request: PlanRequest = {
    walletId: 'wallet',
    attemptId: 'a'.repeat(64),
    nick: vectors.offer.taker_nick,
    tip,
    tipHash: '0f'.repeat(32),
    chain: 'xbt',
    watchOnly: false,
    recipients: [{ address: addr('01'), amount: 100_000 }],
    changeAddress: addr('02'),
    coins: [coin('03', 30_000), coin('04', 100_000), coin('05', 50_000)],
    proofOutpoint: '03'.repeat(32) + ':0',
    feeRate: '2',
    minimumMakers: 1,
  };
  const bonded = parseOrderbook([{ type: PRIVMSG, line: vectors.offer.privmsg_line }], request.nick).offers[0];
  const selection: Selection = { offers: [{ ...bonded, value: 100n }], fees: new Map([[bonded.offer.counterparty, 20]]), totalFee: 20 };
  const current = jest.fn(() => true);
  return { request, selection, current, draft: () => prepareInitialPlan(request, selection) };
}
afterEach(() => jest.useRealTimers());

it('selects the proof coin first and largest available confirmed coins to fund the worst case', () => {
  const f = fixture(),
    review = f.draft().review;
  expect(review.inputs).toBe(2);
  expect(review.inputTotal).toBe(130000);
  expect(review.makerFees).toBe(20);
  expect(review.miningFeeEstimate).toBe(miningFee(4, 4, '2'));
  expect(review.miningFeeMax).toBe(miningFee(7, 4, '2'));
  expect(review.totalMax).toBe(20 + review.miningFeeMax);
  expect(review.makers).toEqual([{ fee: 20, bondValue: '100' }]);
});

it('includes unreturned dust in both the displayed estimate and maximum', () => {
  const f = fixture(),
    max = miningFee(6, 4, '2'),
    estimate = miningFee(3, 4, '2');
  const r = { ...f.request, coins: [{ ...f.request.coins[0], value: 100000 + 20 + max + 10 }] };
  const review = prepareInitialPlan(r, f.selection).review;
  expect(max + 10 - estimate).toBeLessThanOrEqual(TAKER_DUST);
  expect(review.dustAllowance).toBe(10);
  expect(review.miningFeeMax).toBe(max + 10);
  expect(review.miningFeeEstimate).toBe(max + 10);
  expect(review.totalEstimate).toBe(review.totalMax);
});

it('rejects unavailable proof coins, unconfirmed funding, duplicate inputs and insufficient funds', () => {
  const f = fixture();
  for (const patch of [{ frozen: true }, { reserved: true }, { height: tip - 3 }, { value: 19999 }]) {
    expect(() =>
      prepareInitialPlan({ ...f.request, coins: [{ ...f.request.coins[0], ...patch }, ...f.request.coins.slice(1)] }, f.selection),
    ).toThrow('proof coin');
  }
  expect(() => prepareInitialPlan({ ...f.request, coins: [f.request.coins[0]] }, f.selection)).toThrow('Not enough');
  expect(() =>
    prepareInitialPlan({ ...f.request, coins: f.request.coins.map((c, i) => ({ ...c, height: i ? 0 : c.height })) }, f.selection),
  ).toThrow('Not enough');
  expect(() => prepareInitialPlan({ ...f.request, coins: [f.request.coins[0], f.request.coins[0]] }, f.selection)).toThrow('Duplicate');
});

it('rejects changed fee totals, unverified/expired bonds, duplicated makers and unsafe fee rates', () => {
  const f = fixture(),
    offer = f.selection.offers[0];
  for (const s of [
    { ...f.selection, totalFee: 21 },
    { ...f.selection, fees: new Map([[offer.offer.counterparty, 21]]), totalFee: 21 },
    { ...f.selection, offers: [{ ...offer, value: 0n }] },
    { ...f.selection, offers: [{ ...offer, problem: 'chain lookup failed' }] },
    { ...f.selection, offers: [offer, offer] },
  ])
    expect(() => prepareInitialPlan(f.request, s)).toThrow();
  expect(() => prepareInitialPlan({ ...f.request, tip: offer.bond.expiryHeight + 1 }, f.selection)).toThrow('maker');
  for (const feeRate of ['0.9', '101', 'NaN']) expect(() => prepareInitialPlan({ ...f.request, feeRate }, f.selection)).toThrow();
  expect(() => prepareInitialPlan({ ...f.request, feeRate: '100' }, f.selection)).toThrow('headroom');
});

it('binds recipient, change, inputs, fees and wallet/round/directory context into immutable review identity', () => {
  const f = fixture(),
    draft = f.draft();
  const changes = [
    { walletId: 'other' },
    { attemptId: 'b'.repeat(64) },
    { tip: tip + 1 },
    { tipHash: '0e'.repeat(32) },
    { recipients: [{ address: addr('06'), amount: 100000 }] },
    { changeAddress: addr('07') },
    { feeRate: '3' },
  ];
  for (const change of changes) expect(prepareInitialPlan({ ...f.request, ...change }, f.selection).review.id).not.toBe(draft.review.id);
  expect(Object.isFrozen(draft.review)).toBe(true);
  expect(Object.isFrozen(draft.review.makers[0])).toBe(true);
  expect(JSON.stringify(draft)).not.toContain(f.request.coins[0].txid);
});

it('requires literal approval and consumes the exact authorization only once', async () => {
  const f = fixture(),
    draft = f.draft(),
    confirm = jest.fn(async () => true);
  const token = await approveInitialPlan(draft, confirm, { isCurrent: f.current });
  expect(confirm).toHaveBeenCalledWith(draft.review, expect.any(AbortSignal));
  const plan = takeApprovedPlan(token, f.request);
  expect(plan.coins.map(c => c.txid)).toEqual(f.request.coins.slice(0, 2).map(c => c.txid));
  expect(() => takeApprovedPlan(token, f.request)).toThrow('already used');
  await expect(approveInitialPlan(draft, confirm, { isCurrent: f.current })).rejects.toThrow('already reviewed');
  expect(() => takeApprovedPlan({ review: draft.review }, f.request)).toThrow('missing');
});

it.each([false, undefined, 'true', 1])('declined or non-boolean confirmation cannot authorize disclosure (%s)', async answer => {
  const f = fixture();
  await expect(approveInitialPlan(f.draft(), async () => answer as boolean, { isCurrent: f.current })).rejects.toThrow('declined');
});

it('snapshots inputs and fee maps before the UI awaits a decision', async () => {
  const f = fixture(),
    draft = f.draft();
  (f.request.coins[0] as { value: number }).value = 1;
  (f.selection.fees as Map<string, number>).set(f.selection.offers[0].offer.counterparty, 999);
  const token = await approveInitialPlan(draft, async () => true, { isCurrent: f.current });
  const plan = takeApprovedPlan(token, f.request);
  expect(plan.coins[0].value).toBe(30000);
  expect(plan.makers[0].fee).toBe(20);
});

it('does not show a confirmation after pre-cancellation or changed context', async () => {
  const f = fixture(),
    abort = new AbortController(),
    confirm = jest.fn(async () => true);
  abort.abort();
  await expect(approveInitialPlan(f.draft(), confirm, { isCurrent: f.current, signal: abort.signal })).rejects.toThrow('cancelled');
  f.current.mockReturnValue(false);
  await expect(approveInitialPlan(f.draft(), confirm, { isCurrent: f.current })).rejects.toThrow('context changed');
  expect(confirm).not.toHaveBeenCalled();
});

it('expires a never-resolving UI and ignores its late positive answer', async () => {
  jest.useFakeTimers();
  const f = fixture();
  let answer!: (value: boolean) => void, uiSignal!: AbortSignal;
  const pending = approveInitialPlan(
    f.draft(),
    (_review, signal) => {
      uiSignal = signal;
      return new Promise(resolve => {
        answer = resolve;
      });
    },
    { isCurrent: f.current, timeoutMs: 10, now: () => Date.now() },
  );
  await Promise.all([expect(pending).rejects.toThrow('expired'), jest.advanceTimersByTimeAsync(10)]);
  expect(uiSignal.aborted).toBe(true);
  answer(true);
  await Promise.resolve();
});

it('cancels while waiting and invalidates approval if cancelled or changed before use', async () => {
  const f = fixture(),
    abort = new AbortController();
  let answer!: (value: boolean) => void;
  const pending = approveInitialPlan(
    f.draft(),
    () =>
      new Promise(resolve => {
        answer = resolve;
      }),
    { isCurrent: f.current, signal: abort.signal },
  );
  await Promise.resolve();
  abort.abort();
  await expect(pending).rejects.toThrow('cancelled');
  answer(true);
  const next = new AbortController();
  const token = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current, signal: next.signal });
  next.abort();
  expect(() => takeApprovedPlan(token, f.request)).toThrow('stale');
  const token2 = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current });
  f.current.mockReturnValue(false);
  expect(() => takeApprovedPlan(token2, f.request)).toThrow('stale');
});

it('rejects late approval, stale contexts, forged plans, and sanitized UI errors', async () => {
  const f = fixture();
  let clock = 100;
  await expect(
    approveInitialPlan(
      f.draft(),
      async () => {
        clock += 11;
        return true;
      },
      { isCurrent: f.current, timeoutMs: 10, now: () => clock },
    ),
  ).rejects.toThrow('expired');
  const token = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current });
  expect(() => takeApprovedPlan(token, { ...f.request, attemptId: 'b'.repeat(64) })).toThrow('stale');
  await expect(approveInitialPlan({ review: f.draft().review }, async () => true, { isCurrent: f.current })).rejects.toThrow('missing');
  await expect(
    approveInitialPlan(
      f.draft(),
      async () => {
        throw new Error('private detail');
      },
      { isCurrent: f.current },
    ),
  ).rejects.toThrow(/^Plan confirmation failed$/);
});

it('rejects deadline expiry and clock rollback between approval and disclosure', async () => {
  const f = fixture();
  let clock = 100;
  const token = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current, timeoutMs: 10, now: () => clock });
  clock = 110;
  expect(() => takeApprovedPlan(token, f.request)).toThrow('stale');
  clock = 100;
  const rollback = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current, now: () => clock });
  clock = 99;
  expect(() => takeApprovedPlan(rollback, f.request)).toThrow('stale');
});

async function paymentFixture() {
  const f = fixture();
  const token = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current });
  const plan = takeApprovedPlan(token, f.request);
  const maker = {
    nick: plan.makers[0].offer.offer.counterparty,
    coins: [{ txid: '09'.repeat(32), vout: 0, value: 200000, scriptPubKey: '0014' + '09'.repeat(20) }],
    paymentAddress: addr('10'),
    changeAddress: addr('11'),
    makerFee: 20,
    miningContribution: 0,
  };
  const request = {
    coins: plan.coins,
    recipient: plan.review.recipient,
    changeAddress: plan.changeAddress,
    makers: [maker],
    amount: plan.review.amount,
    takerMiningFee: miningFee(3, 4, '2'),
    maxTotalFee: plan.review.totalMax,
    locktime: tip,
  };
  return { ...f, plan, maker, request, build: () => buildPayment(request, async () => 0) };
}

it('binds a constructed transaction to the consumed initial plan without authorizing a signer', async () => {
  const f = await paymentFixture(),
    payment = await f.build();
  expect(() => assertPaymentMatchesPlan(f.plan, payment)).not.toThrow();
  expect(() => assertPaymentMatchesPlan({ ...f.plan }, payment)).toThrow('Consumed initial approval');
});

it('rejects changed recipient/change, input substitutions, and individually increased maker fees', async () => {
  const f = await paymentFixture();
  const substitutions = [
    { recipient: addr('12') },
    { changeAddress: addr('12') },
    { coins: f.request.coins.map((c, i) => (i ? { ...c, txid: '13'.repeat(32) } : c)) },
    { makers: [{ ...f.maker, makerFee: 21 }] },
    { makers: [{ ...f.maker, nick: vectors.offer.taker_nick }] },
  ];
  for (const change of substitutions) {
    const payment = await buildPayment({ ...f.request, ...change }, async () => 0);
    expect(() => assertPaymentMatchesPlan(f.plan, payment)).toThrow();
  }
});

it('rejects fee escalation even if the later transaction is otherwise valid', async () => {
  const f = await paymentFixture();
  const payment = await buildPayment(
    { ...f.request, takerMiningFee: f.plan.review.miningFeeMax + 1, maxTotalFee: f.plan.review.totalMax + 1 },
    async () => 0,
  );
  expect(() => assertPaymentMatchesPlan(f.plan, payment)).toThrow('fee ceiling');
  const valid = await f.build();
  expect(() => assertPaymentMatchesPlan(f.plan, { ...valid, totalFee: valid.totalFee + 1 })).toThrow('fee mismatch');
});

it('snapshots the cancellation source and guards its callback failures', async () => {
  const f = fixture(),
    original = new AbortController(),
    other = new AbortController();
  const options = { isCurrent: f.current, signal: original.signal };
  const token = await approveInitialPlan(f.draft(), async () => true, options);
  options.signal = other.signal;
  original.abort();
  expect(() => takeApprovedPlan(token, f.request)).toThrow('stale');
  const next = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current });
  f.current.mockImplementation(() => {
    throw new Error('private backend detail');
  });
  expect(() => takeApprovedPlan(next, f.request)).toThrow(/^Plan approval is stale$/);
});

it('rejects an invalid initial clock rather than issuing a non-expiring approval', async () => {
  const f = fixture();
  let calls = 0;
  await expect(approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current, now: () => (calls++ ? 100 : NaN) })).rejects.toThrow(
    'expired',
  );
});

it('keeps actual wallet cost within the displayed maximum across maker input counts and dust boundaries', async () => {
  for (const leftover of [0, 1, TAKER_DUST, TAKER_DUST + 1]) {
    const f = fixture(),
      base = miningFee(6, 4, '2');
    const request = { ...f.request, coins: [{ ...f.request.coins[0], value: 100000 + 20 + base + leftover }] };
    const draft = prepareInitialPlan(request, f.selection);
    const token = await approveInitialPlan(draft, async () => true, { isCurrent: f.current });
    const plan = takeApprovedPlan(token, request);
    for (let count = 1; count <= 5; count++) {
      const coins = Array.from({ length: count }, (_, i) => ({
        txid: (30 + i).toString(16).repeat(32),
        vout: 0,
        value: 200000,
        scriptPubKey: '0014' + '09'.repeat(20),
      }));
      const payment = await buildPayment(
        {
          coins: plan.coins,
          recipient: plan.review.recipient,
          changeAddress: plan.changeAddress,
          amount: 100000,
          makers: [
            {
              nick: plan.makers[0].offer.offer.counterparty,
              coins,
              paymentAddress: addr('10'),
              changeAddress: addr('11'),
              makerFee: 20,
              miningContribution: 0,
            },
          ],
          takerMiningFee: miningFee(1 + count, 4, '2'),
          maxTotalFee: plan.review.totalMax,
          locktime: tip,
        },
        async () => 0,
      );
      expect(payment.totalFee).toBeLessThanOrEqual(plan.review.totalMax);
      expect(() => assertPaymentMatchesPlan(plan, payment)).not.toThrow();
    }
  }
});

it('rejects a different validated chain hash even when the height is unchanged', async () => {
  const f = fixture();
  const token = await approveInitialPlan(f.draft(), async () => true, { isCurrent: f.current });
  expect(() => takeApprovedPlan(token, { ...f.request, tipHash: '0e'.repeat(32) })).toThrow('stale');
  expect(() => prepareInitialPlan({ ...f.request, tipHash: '' }, f.selection)).toThrow('context');
});
