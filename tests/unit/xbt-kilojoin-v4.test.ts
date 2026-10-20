import { Transaction } from 'bitcoinjs-lib';
import vectors from './fixtures/kilojoin-v4-vectors.json';
import * as tx from '../../class/xbt/kilojoin/transaction';
import { hash } from '../../class/xbt/kilojoin/crypto';
import { memberMac } from '../../class/xbt/kilojoin/protocol';
const v = vectors.v4;
const raw = Transaction.fromHex(vectors.transaction.raw_tx);
const coins: tx.Coin[] = raw.ins.map((input, i) => ({
  txid: Buffer.from(input.hash).reverse().toString('hex'),
  vout: input.index,
  value: i === 0 ? v.fee_share.perfect_coin : 50000,
  pubkey: Buffer.from(input.witness[1]).toString('hex'),
  type: 'p2wpkh',
}));
const outputs = v.transaction.outputs_in_order;
const makePlan = () =>
  tx.plan(
    coins,
    outputs.slice(0, 4).map(o => o.script),
    outputs.slice(4),
    v.denomination,
    v.outputs,
  );
const context = (): tx.Review => ({
  mine: [coins[0]],
  mixScript: outputs[0].script,
  mixScripts: outputs.slice(0, 2).map(o => o.script),
  maxFee: v.fee_share.without_change,
  feeRate: v.fee_rate,
  seatInputs: [1, 1],
  verified: new Map(coins.map(c => [tx.outpoint(c), { value: c.value, script: tx.coinScript(c).toString('hex') }])),
});
describe('pinned Kilojoin v4 offline transaction vectors', () => {
  test('fees and exact no-change input match upstream', () => {
    expect(tx.feeShare(2, false, 1, 'p2wpkh', 2)).toBe(v.fee_share.without_change);
    expect(tx.feeShare(2, true, 1, 'p2wpkh', 2)).toBe(v.fee_share.with_change);
    expect(tx.change(50000, 10000, 2, 1, 'p2wpkh', 2)).toBe(v.fee_share.change_for_50000);
    expect(tx.change(v.fee_share.perfect_coin, 10000, 2, 1, 'p2wpkh', 2)).toBe(0);
    expect(tx.change(v.fee_share.perfect_coin - 1, 10000, 2, 1, 'p2wpkh', 2)).toBeNull();
    expect(tx.feeShare(1, false, 1, 'p2wpkh', 4)).toBe(198);
  });
  test('ordered blind-message commitment matches upstream', () => {
    const digest = hash(Buffer.concat(v.mac_blind.blinded.map(b => Buffer.from(b, 'hex')))).toString('hex');
    expect(digest).toBe(v.mac_blind.blinded_sha256);
    expect(memberMac(vectors.join.token, 'blind', v.mac_blind.round_id, digest)).toBe(v.mac_blind.mac);
  });
  test('two people with four mixed outputs reproduce the canonical transaction', () => {
    const p = makePlan();
    expect(p.people).toBe(2);
    expect(tx.transaction(p).getId()).toBe(v.transaction.txid_before_signing);
    expect(p.outputs).toEqual(outputs);
    expect(tx.review(p, context())).toMatchObject({ fee: v.transaction.fee, myFee: v.fee_share.without_change });
  });
  test('requires every own output exactly once and enforces fee cap', () => {
    expect(() => tx.review(makePlan(), { ...context(), mixScripts: [outputs[0].script] })).toThrow('count');
    expect(() => tx.review(makePlan(), { ...context(), mixScripts: [outputs[0].script, outputs[0].script] })).toThrow('count');
    expect(() => tx.review(makePlan(), { ...context(), mixScripts: [outputs[0].script, '0014' + 'ab'.repeat(20)] })).toThrow('missing');
    expect(() => tx.review(makePlan(), { ...context(), maxFee: 270 })).toThrow('fee limit');
    const changed = makePlan();
    changed.outputs[0].value--;
    expect(() => tx.review(changed, context())).toThrow('Noncanonical');
  });
  test.each([0, 6, 1.5, NaN])('rejects invalid output count %s', count => {
    expect(() => tx.feeShare(1, false, 1, 'p2wpkh', count)).toThrow();
    expect(() =>
      tx.plan(
        coins,
        outputs.slice(0, 4).map(o => o.script),
        [],
        10000,
        count,
      ),
    ).toThrow();
  });
});
