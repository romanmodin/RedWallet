import {
  ABSOLUTE_GRID,
  RELATIVE_GRID,
  acceptable,
  checkMinerFee,
  decimal,
  feePlan,
  isQuantized,
  miningFee,
  offerFee,
  quantizeAbsoluteUp,
  quantizeRelativeUp,
  relativeFee,
  sweepAmount,
  vsizeEstimate,
  withinLimits,
  Offer,
} from '../../class/joinblaket/fees';
import { CommitmentStore } from '../../class/joinblaket/commitments';
import { eligibleProofCoins, proofThreshold, validatePayment, ProofCoin } from '../../class/joinblaket/preflight';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const f = vectors.fees;
const offer = (o: { nick: string; ordertype: string; cjfee: string; txfee: number }): Offer => ({
  counterparty: o.nick,
  type: o.ordertype,
  cjfee: o.cjfee,
  txfee: o.txfee,
  minsize: 27300,
  maxsize: 10_000_000_000,
});
describe('JoinBlaket pinned rc6 fee vectors', () => {
  test.each(f.relative_fee_cases)('relative fee $amount × $cjfee = $fee', c => {
    expect(relativeFee(c.amount, c.cjfee)).toBe(c.fee);
  });
  test.each(f.offers)('offer fee/grid/default limit: $nick', c => {
    const o = offer(c);
    expect(offerFee(o, f.cj_amount)).toBe(c.fee);
    expect(offerFee(o, f.cj_amount, true)).toBe(c.fee_rounded_up);
    expect(isQuantized(o)).toBe(c.quantized);
    expect(withinLimits(o)).toBe(c.within_default_limits);
    expect(acceptable(o, f.cj_amount)).toBe(c.quantized && c.within_default_limits);
  });
  test.each(f.shapes)('mining fee $inputs inputs/$outputs outputs', c => {
    expect(vsizeEstimate(c.inputs, c.outputs)).toBe(c.vsize_estimate);
    expect(miningFee(c.inputs, c.outputs, String(f.fee_rate_base))).toBe(c.fee_at_base_rate);
    expect(miningFee(c.inputs, c.outputs, String(f.fee_rate_randomized))).toBe(c.fee_at_randomized_rate);
  });
  test('fee grids, fee plans and sweep match upstream exactly', () => {
    expect(RELATIVE_GRID).toEqual(f.quant_rel_grid);
    expect(ABSOLUTE_GRID).toEqual(f.quant_abs_grid);
    expect(quantizeAbsoluteUp(150)).toBe(f.quantize_abs_up_150);
    expect(quantizeRelativeUp('0.2')).toBeNull();
    expect(Object.fromEntries(feePlan(f.offers.slice(0, 2).map(offer), f.cj_amount))).toEqual(f.fee_plan);
    expect(Object.fromEntries(feePlan(f.offers.slice(0, 2).map(offer), f.cj_amount, true))).toEqual(f.fee_plan_equalized);
    expect(sweepAmount(f.sweep.available, f.sweep.relative_fees)).toBe(f.sweep.cj_amount);
  });
  test('half-even rounding stays exact at large integer boundaries', () => {
    expect(relativeFee(5, '0.5')).toBe(2);
    expect(relativeFee(7, '.5')).toBe(4);
    expect(relativeFee(1, '0.5')).toBe(0);
    expect(relativeFee(2_000_000_000_000_005, '0.5')).toBe(1_000_000_000_000_002);
  });
  test.each(['', '-0.1', 'NaN', 'Infinity', '1e999', '1e-999', '1e+-3', '1.2.3', '0x10'])('rejects hostile decimal %s', s => {
    expect(() => decimal(s)).toThrow();
  });
  test('rejects unsafe money, fractional absolute fees, duplicate makers and invalid shapes', () => {
    expect(() => relativeFee(Number.MAX_SAFE_INTEGER + 1, '0.001')).toThrow();
    expect(() => relativeFee(0.1, '0.001')).toThrow();
    expect(() => offerFee({ ...offer(f.offers[1]), cjfee: '1.5' }, 30000)).toThrow();
    expect(() => feePlan([offer(f.offers[0]), offer(f.offers[0])], 30000)).toThrow();
    expect(() => vsizeEstimate(-1, 4)).toThrow();
    expect(() => vsizeEstimate(1, 1001)).toThrow();
    expect(() => miningFee(2, 4, '0.1')).toThrow();
    expect(() => miningFee(2, 4, '101')).toThrow();
  });
  test('fee caps, supported types, amount bounds and quantization cannot be bypassed', () => {
    const o = offer(f.offers[0]);
    expect(acceptable({ ...o, type: 'swreloffer' }, 30000)).toBe(false);
    expect(acceptable({ ...o, cjfee: '0.002' }, 30000)).toBe(false);
    expect(acceptable({ ...o, cjfee: '0.00025' }, 30000)).toBe(false);
    expect(acceptable({ ...o, maxsize: 1 }, 30000)).toBe(false);
    expect(acceptable(o, 100)).toBe(false);
    expect(acceptable({ ...offer(f.offers[1]), cjfee: '1000' }, 30000)).toBe(false);
    expect(acceptable({ ...o, cjfee: '0.00020' }, 30000)).toBe(true);
    expect(() => checkMinerFee(1271, 1000, 2, 4)).not.toThrow();
    for (const n of [999, 1270, 28101]) expect(() => checkMinerFee(n, 1000, 2, 4)).toThrow();
  });
});

const a = 'ab'.repeat(32),
  b = 'cd'.repeat(32);
function storage(initial: string | null = null) {
  let value = initial;
  const persistence = {
    load: jest.fn(async () => value),
    save: jest.fn(async (next: string) => {
      value = next;
    }),
  };
  return { persistence, store: new CommitmentStore(persistence) };
}
describe('commitments are consumed before disclosure', () => {
  test('concurrent calls cannot authorize revealing one commitment twice', async () => {
    const { store, persistence } = storage();
    expect(await Promise.all([store.consume(a), store.consume(a.toUpperCase()), store.consume(b)])).toEqual([true, false, true]);
    expect(persistence.save).toHaveBeenCalledTimes(2);
    expect(JSON.parse(await store.exportBackup())).toEqual({ used: [a, b], external: {} });
  });
  test('consume does not resolve until durable save resolves', async () => {
    let finish!: () => void;
    const saved = new Promise<void>(resolve => {
      finish = resolve;
    });
    const store = new CommitmentStore({ load: async () => null, save: async () => saved });
    let permitted = false;
    const pending = store.consume(a).then(ok => {
      permitted = ok;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(permitted).toBe(false);
    finish();
    await pending;
    expect(permitted).toBe(true);
  });
  test('write failure authorizes no disclosure and does not poison later operations', async () => {
    const { store, persistence } = storage();
    persistence.save.mockRejectedValueOnce(new Error('disk full'));
    await expect(store.consume(a)).rejects.toThrow('disk full');
    expect(await store.consume(a)).toBe(true);
    expect(await store.consume(a)).toBe(false);
  });
  test.each(['{', '{}', '{"used":[]}', '{"used":["bad"],"external":{}}', '{"used":[],"external":{"unsupported":1}}'])(
    'corruption fails closed: %s',
    async text => {
      const { store, persistence } = storage(text);
      await expect(store.consume(a)).rejects.toThrow();
      await expect(store.isUsed(a)).rejects.toThrow();
      expect(persistence.save).not.toHaveBeenCalled();
    },
  );
  test('backup merge is a union, preserving already consumed commitments', async () => {
    const { store, persistence } = storage(JSON.stringify({ used: [a], external: {} }));
    await store.mergeBackup(JSON.stringify({ used: [b.toUpperCase()], external: {} }));
    expect(JSON.parse(await store.exportBackup())).toEqual({ used: [a, b], external: {} });
    const restored = new CommitmentStore(persistence);
    expect(await restored.consume(a)).toBe(false);
    expect(await restored.consume(b)).toBe(false);
    await expect(restored.mergeBackup('{"used":["invalid"],"external":{}}')).rejects.toThrow();
    expect(await restored.isUsed(a)).toBe(true);
  });
});
const recipient = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const request = { chain: 'xbt' as const, watchOnly: false, recipients: [{ address: recipient, amount: 100001 }] };
const coin: ProofCoin = { txid: a, vout: 0, value: 20001, height: 96, frozen: false, reserved: false };
describe('local payment preflight does not authorize a round', () => {
  test('requires one hot XBT payment to a valid P2WPKH recipient', () => {
    expect(validatePayment(request)).toEqual(request.recipients[0]);
    for (const invalid of [
      { ...request, chain: 'btc' as const },
      { ...request, watchOnly: true },
      { ...request, recipients: [] },
      { ...request, recipients: [...request.recipients, ...request.recipients] },
      { ...request, recipients: [{ address: recipient, amount: 0 }] },
      { ...request, recipients: [{ address: 'bc1qnot-an-address', amount: 100 }] },
      { ...request, recipients: [{ address: 'bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr', amount: 100 }] },
    ]) {
      expect(() => validatePayment(invalid)).toThrow();
    }
  });
  test('at least 20 percent uses ceiling; five confirmations is inclusive', () => {
    expect(proofThreshold(100001)).toBe(20001);
    expect(eligibleProofCoins([coin], 100001, 100)).toEqual([coin]);
    for (const c of [
      { ...coin, height: 97 },
      { ...coin, height: 0 },
      { ...coin, value: 20000 },
      { ...coin, frozen: true },
      { ...coin, reserved: true },
    ])
      expect(eligibleProofCoins([c], 100001, 100)).toEqual([]);
  });
  test('malformed or duplicate coins and unavailable tip fail closed', () => {
    expect(() => eligibleProofCoins([coin, { ...coin, txid: a.toUpperCase() }], 100001, 100)).toThrow();
    expect(() => eligibleProofCoins([{ ...coin, height: 101 }], 100001, 100)).toThrow();
    expect(() => eligibleProofCoins([{ ...coin, value: NaN }], 100001, 100)).toThrow();
    expect(() => eligibleProofCoins([coin], 100001, 0)).toThrow();
  });
});
