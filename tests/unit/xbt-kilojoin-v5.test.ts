import { runKilojoinV5SelfTest } from '../../class/xbt/kilojoin/v5-self-test';
import { Transaction } from 'bitcoinjs-lib';
import vectors from './fixtures/kilojoin-v5-vectors.json';
import rsa from './fixtures/kilojoin-rfc9474.json';
import old from './fixtures/kilojoin-vectors.json';
import * as tx from '../../class/xbt/kilojoin/transaction';
import { parsePool } from '../../class/xbt/kilojoin/protocol';
import { signEvent } from '../../class/xbt/kilojoin/crypto';

const v = vectors.v5;
const original = Transaction.fromHex(vectors.transaction.raw_tx);
const coins: tx.Coin[] = original.ins.map((input, i) => ({
  txid: Buffer.from(input.hash).reverse().toString('hex'),
  vout: input.index,
  value: i === 0 ? 50000 : v.joiner_perfect_coin,
  pubkey: Buffer.from(input.witness[1]).toString('hex'),
  type: 'p2wpkh',
}));
const mixes = v.transaction.outputs_in_order.slice(0, 2).map(o => o.script);
const changes = v.transaction.outputs_in_order.slice(4);
const makePlan = () => tx.plan(coins, mixes, changes, 10000, 2, v.payments_message);
const context = (): tx.Review => ({
  mine: [coins[1]],
  mixScript: mixes[0],
  mixScripts: mixes,
  maxFee: 271,
  feeRate: 2,
  seatInputs: [1, 1],
  paymentPool: { amounts: v.payments, creatorIndex: 0, changes },
  verified: new Map(coins.map(c => [tx.outpoint(c), { value: c.value, script: tx.coinScript(c).toString('hex') }])),
});
const terms = {
  v: 5,
  app: 'kilowallet',
  network: 'blake2b',
  id: old.pool.id,
  public_key: old.pool.pool_pub,
  creator: old.join.join_pub,
  blind_key: rsa.N + ':10001',
  denomination: 10000,
  outputs: 2,
  payments: [7123, 12877],
  fee_rate: 2,
  min_peers: 2,
  max_peers: 5,
  private: false,
  timeout: 1791401000,
  state: 'open',
  peers: 2,
  script: 'p2wpkh',
  max_inputs: 10,
};
const announcement = (patch: Record<string, unknown> = {}) =>
  signEvent(
    {
      kind: 32022,
      created_at: 1791400000,
      tags: [
        ['d', terms.id],
        ['t', 'kilojoin'],
      ],
      content: JSON.stringify({ ...terms, ...patch }),
    },
    Buffer.from(old.pool.pool_secret, 'hex'),
    Buffer.alloc(32, 7),
  );

describe('Kilombino v5 official vectors and hostile payment terms', () => {
  test('canonical transaction, output ordering and fees match the published v5 vector', () => {
    const p = makePlan();
    expect(tx.transaction(p).getId()).toBe(v.transaction.txid_before_signing);
    expect(p.outputs).toEqual(v.transaction.outputs_in_order);
    expect(p.people).toBe(2);
    expect(tx.review(p, context())).toMatchObject({ fee: 604, myFee: 271 });
    expect(tx.changeOf(50000, 20000, 2, 1, 'p2wpkh', 2)).toBe(29667);
  });
  test('v3/v4 remain accepted and v5 can independently be disabled', () => {
    expect(parsePool(announcement(), 1791400000).v).toBe(5);
    expect(() => parsePool(announcement(), 1791400000, true, false)).toThrow('Unsupported');
    expect(parsePool(announcement({ v: 3, outputs: 1, payments: undefined }), 1791400000).v).toBe(3);
    expect(parsePool(announcement({ v: 4, payments: undefined }), 1791400000).v).toBe(4);
    expect(() => parsePool(announcement({ v: 6 }), 1791400000)).toThrow('Unsupported');
  });
  test('per-person minimum allows two 5000-sat outputs and rejects three 3000-sat outputs', () => {
    expect(parsePool(announcement({ denomination: 5000, payments: [330, 9670] }), 1791400000).denomination).toBe(5000);
    expect(parsePool(announcement({ v: 4, denomination: 5000, payments: undefined }), 1791400000).denomination).toBe(5000);
    expect(() => parsePool(announcement({ outputs: 3, denomination: 3000, payments: [9000] }), 1791400000)).toThrow();
    expect(() => parsePool(announcement({ outputs: 5, denomination: 999, payments: [4995] }), 1791400000)).toThrow();
    expect(parsePool(announcement({ outputs: 1, payments: [10000] }), 1791400000).outputs).toBe(1);
  });
  test.each([
    undefined,
    [],
    [20000, 330],
    [329, 19671],
    ['7123', 12877],
    [7123.5, 12876.5],
    [330, 330, 330, 330, 330, 18350],
    [Number.MAX_SAFE_INTEGER, 330],
    null,
  ])('rejects malformed payment announcements %j', payments => {
    expect(() => parsePool(announcement({ payments }), 1791400000)).toThrow();
  });
  test('terms retain an immutable copy of the payment commitment', () => {
    const p = parsePool(announcement(), 1791400000);
    expect(Object.isFrozen(p.payments)).toBe(true);
    expect(() => (p.payments as number[]).push(123)).toThrow();
  });
  test('payments are an exact multiset including repeated denomination-sized payments', () => {
    const payments = v.payments_message.map(o => ({ ...o, value: 10000 }));
    const p = tx.plan(coins, mixes, changes, 10000, 2, payments);
    expect(tx.review(p, { ...context(), paymentPool: { ...context().paymentPool!, amounts: [10000, 10000] } }).fee).toBe(604);
    expect(() => tx.paymentOutputs(payments, [9999, 10001], 'p2wpkh')).toThrow('changed');
  });
  test.each([
    (p: tx.Plan) => {
      p.outputs[2].value++;
    },
    (p: tx.Plan) => {
      p.outputs[0].value--;
    },
    (p: tx.Plan) => {
      p.outputs.reverse();
    },
    (p: tx.Plan) => {
      p.outputs.push({ script: '0014' + 'ab'.repeat(20), value: 330 });
    },
    (p: tx.Plan) => {
      p.payments![0].value++;
    },
    (p: tx.Plan) => {
      delete p.payments;
    },
    (p: tx.Plan) => {
      p.people++;
    },
  ])('refuses a mutated payment plan before signing', mutate => {
    const p = makePlan();
    mutate(p);
    expect(() => tx.review(p, context())).toThrow();
  });
  test('rejects extra or substituted changes even when the fee remains in range', () => {
    const wrong = tx.plan(coins, mixes, [{ script: '0014' + 'ab'.repeat(20), value: 29667 }], 10000, 2, v.payments_message);
    expect(() => tx.review(wrong, context())).toThrow('Noncanonical');
  });
  test('requires independently verified inputs, all own outputs and the user fee cap', () => {
    expect(() => tx.review(makePlan(), { ...context(), verified: new Map() })).toThrow('Unverified');
    expect(() => tx.review(makePlan(), { ...context(), mixScripts: [mixes[0]] })).toThrow('count');
    expect(() => tx.review(makePlan(), { ...context(), maxFee: 270 })).toThrow('fee limit');
    expect(() => tx.review(makePlan(), { ...context(), paymentPool: undefined })).toThrow('context');
    expect(() => tx.review(makePlan(), { ...context(), paymentPool: { ...context().paymentPool!, creatorIndex: -1 } })).toThrow();
  });
  test.each([
    [{ script: mixes[0], value: 7123 }, v.payments_message[1]],
    [{ ...v.payments_message[0], script: tx.coinScript(coins[0]).toString('hex') }, v.payments_message[1]],
    [{ ...v.payments_message[0], script: changes[0].script }, v.payments_message[1]],
    [{ ...v.payments_message[0], script: '5120' + 'ab'.repeat(32) }, v.payments_message[1]],
    [v.payments_message[0], { ...v.payments_message[1], script: v.payments_message[0].script }],
  ])('rejects mixed/payment/change overlap, input reuse and the wrong script type', (...payments) => {
    expect(() => tx.plan(coins, mixes, changes, 10000, 2, payments as tx.Output[])).toThrow();
  });
});

test('v5 native self-test matches the official payment vector offline', () => {
  expect(() => runKilojoinV5SelfTest()).not.toThrow();
});
