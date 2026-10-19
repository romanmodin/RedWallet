import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { parseVerifiedParentTransaction } from './verified-transaction';
import { assertSignedUnifiedTransactionMatchesPsbt } from './unified-psbt';

/** Authenticate original signatures and prevouts before exposing any fee information. */
export function inspectBip84Original(
  txid: string,
  raw: string,
  parents: ReadonlyMap<string, string>,
  ownsInput: (script: Uint8Array) => boolean,
) {
  const original = parseVerifiedParentTransaction(txid, raw);
  if (!original.ins.length || original.isCoinbase() || !original.ins.some(input => input.sequence < 0xfffffffe)) {
    throw new Error('Original does not support replacement');
  }
  const expected = new bitcoin.Psbt();
  expected.setVersion(original.version);
  expected.setLocktime(original.locktime);
  const seen = new Set<string>();
  let inputValue = 0n;
  original.ins.forEach(input => {
    const id = Buffer.from(input.hash).reverse().toString('hex');
    const key = `${id}:${input.index}`;
    if (seen.has(key)) throw new Error('Duplicate original input');
    seen.add(key);
    const parentRaw = parents.get(id);
    if (!parentRaw) throw new Error('Missing raw parent');
    const parent = parseVerifiedParentTransaction(id, parentRaw);
    const output = parent.outs[input.index];
    if (!output || output.script.length !== 22 || output.script[0] !== 0 || output.script[1] !== 20 || !ownsInput(output.script)) {
      throw new Error('Original input is not owned P2WPKH');
    }
    inputValue += output.value;
    expected.addInput({
      hash: id,
      index: input.index,
      sequence: input.sequence,
      witnessUtxo: output,
    });
  });
  original.outs.forEach(output => expected.addOutput(output));
  // Verifies every 0x21 signature against all raw-verified input amounts and scripts.
  assertSignedUnifiedTransactionMatchesPsbt(raw, expected, (key, digest, signature) => ecc.verify(digest, key, signature));
  const oldFee = inputValue - original.outs.reduce((sum, output) => sum + output.value, 0n);
  if (oldFee < 0n || oldFee > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Invalid original fee');
  const priced = original.clone();
  // Worst-case DER signature plus sighash and compressed public key; actual signed size may be smaller.
  priced.ins.forEach((_, index) => priced.setWitness(index, [Buffer.alloc(73), Buffer.alloc(33)]));
  const vsize = priced.virtualSize();
  return { original, oldFee: Number(oldFee), maximumVsize: vsize };
}

/** Server-decoded addresses, values and fees are never inputs. */
export function planBip84Replacement(
  txid: string,
  raw: string,
  parents: ReadonlyMap<string, string>,
  feeRate: number,
  ownsInput: (script: Uint8Array) => boolean,
  isChange: (script: Uint8Array) => boolean,
) {
  if (!Number.isFinite(feeRate) || feeRate <= 0) throw new Error('Invalid replacement fee rate');
  const inspected = inspectBip84Original(txid, raw, parents, ownsInput);
  const { original, maximumVsize: vsize } = inspected;
  const oldFee = BigInt(inspected.oldFee);
  const requestedFee = Math.ceil(vsize * feeRate);
  if (!Number.isSafeInteger(requestedFee)) throw new Error('Replacement fee exceeds safe range');
  const fee = BigInt(requestedFee);
  if (fee < oldFee + BigInt(vsize) || Number(fee) / vsize <= Number(oldFee) / original.virtualSize()) {
    throw new Error('Replacement must cover original fee and incremental relay fee');
  }
  let remaining = fee - oldFee;
  const outputs = original.outs.map(output => {
    let value = output.value;
    if (isChange(output.script)) {
      if (output.script.length !== 22 || output.script[0] !== 0 || output.script[1] !== 20) {
        throw new Error('Change must be P2WPKH');
      }
      const available = value > 294n ? value - 294n : 0n;
      const reduction = available < remaining ? available : remaining;
      value -= reduction;
      remaining -= reduction;
    }
    return { script: Uint8Array.from(output.script), value };
  });
  if (remaining !== 0n) throw new Error('Insufficient change; recipient amounts cannot be reduced');
  return { original, outputs, fee: Number(fee), maximumVsize: vsize };
}
