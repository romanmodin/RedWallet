/** Offline official v5 vector. Synthetic public coins; no keys, relay, wallet or broadcaster. */
import vector from './v5-self-test-vector.json';
import { Coin, coinScript, outpoint, plan, review, transaction } from './transaction';

export function runKilojoinV5SelfTest(): void {
  const coins = vector.coins as Coin[];
  const expected = vector.transaction;
  const mixes = expected.outputs_in_order.slice(0, vector.outputs).map(o => o.script);
  const changes = expected.outputs_in_order.slice(vector.outputs + vector.payments.length);
  const p = plan(coins, mixes, changes, vector.denomination, vector.outputs, vector.payments_message);
  const checked = review(p, {
    mine: [coins[1]],
    mixScript: mixes[0],
    mixScripts: mixes,
    maxFee: 271,
    feeRate: vector.fee_rate,
    seatInputs: [1, 1],
    paymentPool: { amounts: vector.payments, creatorIndex: 0, changes },
    verified: new Map(coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex') }])),
  });
  if (
    transaction(p).getId() !== expected.txid_before_signing ||
    checked.fee !== expected.fee ||
    checked.myFee !== 271 ||
    p.outputs.length !== expected.outputs_in_order.length ||
    p.outputs.some((o, i) => o.script !== expected.outputs_in_order[i].script || o.value !== expected.outputs_in_order[i].value)
  )
    throw new Error('Native v5 payment transaction vector failed');
}
