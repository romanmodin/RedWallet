import vectors from './fixtures/kilojoin-kotlin-rosters.json';
import { Coin, change, feeShare, coinScript } from '../../class/xbt/kilojoin/transaction';
import { Terms, changeMessage } from '../../class/xbt/kilojoin/protocol';
import { parseSeat } from '../../class/xbt/kilojoin/roster';

test.each(vectors.fees)('matches actual Kotlin $type fees: $outputs outputs / $inputs inputs / $rate rate / $value sats', v => {
  const type = v.type as Coin['type'];
  expect(feeShare(v.rate, true, v.inputs, type, v.outputs)).toBe(v.feeWithChange);
  expect(feeShare(v.rate, false, v.inputs, type, v.outputs)).toBe(v.feeWithoutChange);
  expect(change(v.value, v.amount, v.rate, v.inputs, type, v.outputs)).toBe(v.change);
});

test.each(vectors.seats)('accepts actual Kotlin $type roster ownership proofs for $outputs outputs', v => {
  const terms = {
    id: vectors.poolId,
    v: v.outputs === 1 ? 3 : 4,
    outputs: v.outputs,
    script: v.type,
    denomination: 1000000,
    fee_rate: 1,
    max_inputs: 10,
  } as Terms;
  const seat = parseSeat(v.seat, terms);
  expect(seat.coins.map(c => coinScript(c).toString('hex'))).toEqual(v.coinScripts);
  expect(changeMessage(terms.id, seat.coins, seat.change_script, seat.change_value).toString('hex')).toBe(v.changeMessage);
  expect(() => parseSeat({ ...v.seat, change_value: v.seat.change_value + 1 }, terms)).toThrow('Invalid seat change');
  expect(() => parseSeat({ ...v.seat, join_pub: '11'.repeat(32) }, terms)).toThrow('Invalid ownership proof');
});
