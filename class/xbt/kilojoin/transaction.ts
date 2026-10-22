/** Kilombino's canonical Kilojoin transaction rules, adapted under Apache-2.0.
 * Offline only. No key access, signing callback, relay or broadcast capability.
 */
import { Transaction, payments, initEccLib, script as bitcoinScript } from 'bitcoinjs-lib';
import ecc from '../../../blue_modules/noble_ecc';
import { unifiedSegwitV0SighashAll, unifiedTaprootKeyPathSighashAll } from '../unified-sighash';
import { hex, utf8Hash } from './crypto';
initEccLib(ecc);
export type ScriptType = 'p2wpkh' | 'p2tr';
export type Coin = {
  txid: string;
  vout: number;
  value: number;
  pubkey: string;
  type: ScriptType;
};
export type Output = { script: string; value: number };
export type Plan = {
  coins: Coin[];
  outputs: Output[];
  amount: number;
  people: number;
  outputsPerPerson?: number;
  type: ScriptType;
};
export const DUST = 294;
const MAX_MONEY = 21000000 * 100000000;
export const outpoint = (c: Coin): string => `${c.txid}:${c.vout}`;
function integer(value: number, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error('Invalid integer/amount');
}
function checkType(type: ScriptType): void {
  if (type !== 'p2wpkh' && type !== 'p2tr') throw new Error('Unsupported script type');
}
export function coinScript(c: Coin): Buffer {
  checkType(c.type);
  hex(c.txid, 32);
  integer(c.vout, 0, 0xffffffff);
  integer(c.value, 1, MAX_MONEY);
  const key = hex(c.pubkey, 33);
  if (!ecc.isPoint(key) || (key[0] !== 2 && key[0] !== 3)) throw new Error('Invalid coin public key');
  return Buffer.from(
    c.type === 'p2wpkh' ? payments.p2wpkh({ pubkey: key }).output! : payments.p2tr({ internalPubkey: key.subarray(1) }).output!,
  );
}
export function isType(script: string, type: ScriptType): boolean {
  return (type === 'p2wpkh' ? /^0014[0-9a-f]{40}$/ : /^5120[0-9a-f]{64}$/).test(script);
}
export function feeShare(rate: number, withChange = true, inputs = 1, type: ScriptType = 'p2wpkh', outputs = 1): number {
  checkType(type);
  integer(inputs, 1, 10);
  integer(outputs, 1, 5);
  if (!Number.isFinite(rate) || rate < 1 || rate > 500) throw new Error('Invalid fee rate');
  return Math.ceil(
    rate * ((type === 'p2tr' ? 57.75 : 68) * inputs + (type === 'p2tr' ? 43 : 31) * (outputs + (withChange ? 1 : 0)) + 5.25),
  );
}
export function change(value: number, amount: number, rate: number, inputs = 1, type: ScriptType = 'p2wpkh', outputs = 1): number | null {
  integer(value, 1, MAX_MONEY);
  integer(amount, 1000, 100000000);
  const remainder = value - outputs * amount - feeShare(rate, true, inputs, type, outputs);
  if (remainder > DUST) return remainder;
  return value - outputs * amount - feeShare(rate, false, inputs, type, outputs) >= 0 ? 0 : null;
}
export function plan(coins: Coin[], mixes: string[], changes: Output[], amount: number, outputsPerPerson = 1): Plan {
  integer(amount, 1000, 100000000);
  integer(outputsPerPerson, 1, 5);
  const people = mixes.length / outputsPerPerson;
  integer(people, 2, 20);
  integer(coins.length, people, people * 10);
  if (changes.length > people) throw new Error('Too many change outputs');
  const type = coins[0].type;
  const inputScripts = new Set(coins.map(c => coinScript(c).toString('hex')));
  if (coins.some(c => c.type !== type)) throw new Error('Mixed script types');
  if (new Set(coins.map(outpoint)).size !== coins.length) throw new Error('Duplicate coin');
  const scripts = [...mixes, ...changes.map(o => o.script)];
  if (scripts.some(s => !isType(s, type))) throw new Error('Wrong output script type');
  if (new Set(scripts).size !== scripts.length) throw new Error('Duplicate output');
  if (scripts.some(s => inputScripts.has(s))) throw new Error('Input address reuse');
  changes.forEach(o => integer(o.value, DUST + 1, MAX_MONEY));
  const total = coins.reduce((n, c) => n + c.value, 0);
  integer(total, 1, MAX_MONEY);
  const outputs = [
    ...mixes
      .slice()
      .sort()
      .map(script => ({ script, value: amount })),
    ...changes.map(o => ({ ...o })).sort((a, b) => (a.script < b.script ? -1 : a.script > b.script ? 1 : 0)),
  ];
  if (outputs.reduce((n, o) => n + o.value, 0) > total) throw new Error('Outputs exceed inputs');
  return {
    coins: coins.map(c => ({ ...c })).sort((a, b) => (a.txid < b.txid ? -1 : a.txid > b.txid ? 1 : a.vout - b.vout)),
    outputs,
    amount,
    people,
    ...(outputsPerPerson === 1 ? {} : { outputsPerPerson }),
    type,
  };
}
export function transaction(p: Plan): Transaction {
  const tx = new Transaction();
  tx.version = 2;
  tx.locktime = 0;
  p.coins.forEach(c => tx.addInput(Buffer.from(hex(c.txid, 32)).reverse(), c.vout, 0xfffffffd));
  p.outputs.forEach(o => tx.addOutput(hex(o.script), BigInt(o.value)));
  return tx;
}
export function digest(p: Plan, index: number): Buffer {
  const tx = transaction(p);
  const spent = p.coins.map(c => ({
    value: BigInt(c.value),
    script: coinScript(c),
  }));
  if (p.type === 'p2tr') return unifiedTaprootKeyPathSighashAll(tx, index, spent);
  if (!spent[index]) throw new Error('Invalid input index');
  const code = Buffer.concat([Buffer.from('76a914', 'hex'), spent[index].script.subarray(2), Buffer.from('88ac', 'hex')]);
  return unifiedSegwitV0SighashAll(tx, index, spent, code);
}
export function verifySignature(p: Plan, index: number, signature: string): boolean {
  try {
    const sig = hex(signature);
    const c = p.coins[index];
    if (!c || sig[sig.length - 1] !== 0x21) return false;
    if (p.type === 'p2tr') return sig.length === 65 && ecc.verifySchnorr!(digest(p, index), coinScript(c).subarray(2), sig.subarray(0, 64));
    sig[sig.length - 1] = 1;
    return ecc.verify(digest(p, index), hex(c.pubkey, 33), bitcoinScript.signature.decode(sig).signature);
  } catch {
    return false;
  }
}
export function assemble(p: Plan, signatures: ReadonlyMap<string, string>): string {
  if (signatures.size !== p.coins.length) throw new Error('Signature count mismatch');
  const tx = transaction(p);
  p.coins.forEach((c, i) => {
    const sig = signatures.get(outpoint(c));
    if (!sig || !verifySignature(p, i, sig)) throw new Error('Invalid or missing signature');
    tx.setWitness(i, p.type === 'p2tr' ? [hex(sig)] : [hex(sig), hex(c.pubkey, 33)]);
  });
  return tx.toHex();
}
export const ownershipMessage = (pool: string, joinKey: string, c: Coin): Buffer =>
  utf8Hash(`kilojoin/v1/own|${pool}|${joinKey}|${outpoint(c)}|${c.value}`);
export function verifyOwnership(pool: string, joinKey: string, c: Coin, der: string): boolean {
  try {
    coinScript(c);
    hex(joinKey, 32);
    const sig = bitcoinScript.signature.decode(Buffer.concat([hex(der), Buffer.from([1])])).signature;
    return ecc.verify(ownershipMessage(pool, joinKey, c), hex(c.pubkey, 33), sig, false);
  } catch {
    return false;
  }
}
export type Review = {
  mine: Coin[];
  mixScript: string;
  mixScripts?: string[];
  changeScript?: string;
  maxFee: number;
  feeRate: number;
  seatInputs: number[];
  verified: ReadonlyMap<string, { value: number; script: string }>;
};
/** Every peer prevout must be independently fetched and unspent before calling review.
 * Returns a snapshot for the confirmation UI; never signs. No peer-provided amount is trusted.
 */
export function review(p: Plan, r: Review): { txHex: string; txid: string; fee: number; myFee: number } {
  integer(r.maxFee, 0, MAX_MONEY);
  integer(r.mine.length, 1, 10);
  const count = p.outputsPerPerson ?? 1;
  integer(count, 1, 5);
  const mixedCount = p.people * count;
  const ownScripts = r.mixScripts ?? [r.mixScript];
  if (ownScripts.length !== count || new Set(ownScripts).size !== count) throw new Error('Own output count mismatch');
  const canonical = plan(
    p.coins,
    p.outputs.slice(0, mixedCount).map(o => o.script),
    p.outputs.slice(mixedCount),
    p.amount,
    count,
  );
  if (transaction(canonical).toHex() !== transaction(p).toHex() || p.type !== canonical.type) throw new Error('Noncanonical plan');
  if (r.seatInputs.length !== p.people || r.seatInputs.reduce((n, c) => n + c, 0) !== p.coins.length) throw new Error('Seat mismatch');
  r.seatInputs.forEach(n => integer(n, 1, 10));
  if (new Set(r.mine.map(outpoint)).size !== r.mine.length) throw new Error('Duplicate own coin');
  for (const c of p.coins) {
    const prev = r.verified.get(outpoint(c));
    if (!prev || prev.value !== c.value || prev.script !== coinScript(c).toString('hex')) throw new Error('Unverified prevout');
  }
  for (const mine of r.mine) {
    const c = p.coins.find(c => outpoint(c) === outpoint(mine));
    if (!c || c.value !== mine.value || c.pubkey !== mine.pubkey || c.type !== mine.type) throw new Error('Own coin changed');
  }
  const ownValue = r.mine.reduce((n, c) => n + c.value, 0);
  const expected = change(ownValue, p.amount, r.feeRate, r.mine.length, p.type, count);
  if (expected === null) throw new Error('Insufficient own funds');
  if (ownScripts.some(script => p.outputs.slice(0, mixedCount).filter(o => o.script === script && o.value === p.amount).length !== 1))
    throw new Error('Own mixed output missing');
  if (
    expected > 0 &&
    (!r.changeScript || p.outputs.slice(mixedCount).filter(o => o.script === r.changeScript && o.value === expected).length !== 1)
  )
    throw new Error('Own change missing or changed');
  if (expected === 0 && r.changeScript && p.outputs.some(o => o.script === r.changeScript)) throw new Error('Unexpected own change');
  const myFee = ownValue - count * p.amount - expected;
  if (myFee > r.maxFee) throw new Error('User fee limit exceeded');
  const fee = p.coins.reduce((n, c) => n + c.value, 0) - p.outputs.reduce((n, o) => n + o.value, 0);
  const vb = 10.5 + (p.type === 'p2tr' ? 57.75 : 68) * p.coins.length + (p.type === 'p2tr' ? 43 : 31) * p.outputs.length;
  if (
    fee < Math.floor(r.feeRate * vb * 0.95) ||
    fee > r.seatInputs.reduce((n, c) => n + feeShare(r.feeRate, true, c, p.type, count), 0) + (DUST + 1) * p.people
  )
    throw new Error('Round fee outside bounds');
  const tx = transaction(p);
  return { txHex: tx.toHex(), txid: tx.getId(), fee, myFee };
}
