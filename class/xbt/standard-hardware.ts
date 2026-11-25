import { Psbt, Transaction, address } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { assertSignedBtcTransaction } from '../btc/psbt';
import { assertSignedUnifiedTransactionMatchesPsbt } from './unified-psbt';
import { parseVerifiedParentTransaction } from './verified-transaction';

import { STANDARD_HARDWARE_RELEASE_ENABLED } from './standard-hardware-platform';
export { STANDARD_HARDWARE_RELEASE_ENABLED };

export type FundingInput = { txid: string; vout: number; value: number; address?: string };

// Keep selected coin identifiers out of logs, including when an Error is serialized.
export class UnsupportedFundingSignatures extends Error {
  #txid: string;
  #vout: number;

  constructor(coin: FundingInput) {
    super('Protection unverified: unsupported funding signatures');
    this.#txid = coin.txid;
    this.#vout = coin.vout;
  }

  matches(coin: { txid: string; vout: number }) {
    return coin.txid === this.#txid && coin.vout === this.#vout;
  }
}

export type FundingSource = {
  raw: (ids: string[]) => Promise<Record<string, string>>;
  history: (addresses: string[]) => Promise<Record<string, { tx_hash: string; height: number }[]>>;
  tip: () => Promise<number | null>;
  separation?: (parents: Transaction[]) => Promise<void>;
};
export type FundingProof = { checkedAt: number; parents: Record<string, string> };
export function assertStandardHardwareReleased(): void {
  if (!STANDARD_HARDWARE_RELEASE_ENABLED) throw new Error('Standard hardware signing is unavailable until coin separation can be verified');
}
const ACTIVATION = 961640;
const MAX_INPUTS = 64;
const MAX_TRANSACTIONS = 256;
const MAX_DEPTH = 64;
const MAX_HISTORY_HEX_CHARS = 16_000_000;
const TXID = /^[0-9a-f]{64}$/;

/** Standard change is eligible only when every input traces to verified Unified
 * funding with a confirmed conflicting SHA256 spend. No ancestry permission is
 * persisted: the complete bounded proof is collected again before broadcast.
 * Coinbase, mixed signature modes and non-P2WPKH ancestry remain unsupported.
 */
export async function verifyStandardHardwareFunding(inputs: FundingInput[], source: FundingSource): Promise<FundingProof> {
  if (!inputs.length || inputs.length > MAX_INPUTS) throw new Error('Compatibility mode supports 1–64 selected inputs');
  const outpoints = new Set<string>();
  for (const input of inputs) {
    const point = input.txid + ':' + input.vout;
    if (!TXID.test(input.txid) || !Number.isSafeInteger(input.vout) || input.vout < 0 || input.vout > 0xffffffff || outpoints.has(point))
      throw new Error('Protection unverified: invalid or duplicate funding input');
    outpoints.add(point);
  }
  const raws = new Map<string, string>();
  const transactions = new Map<string, Transaction>();
  const roots = new Map<string, Transaction>();
  const verified = new Map<string, number>();
  const visiting = new Set<string>();
  const confirmations = new Map<string, Set<string>>();
  let hexCharacters = 0;
  const load = async (ids: string[]) => {
    const missing = [...new Set(ids)].filter(id => !transactions.has(id));
    if (!missing.length) return;
    if (transactions.size + missing.length > MAX_TRANSACTIONS) throw new Error('Protection verification exceeds ancestor limit');
    const result = await source.raw(missing);
    for (const id of missing) {
      const raw = result[id];
      if (typeof raw !== 'string' || !raw || raw.length > 2_000_000)
        throw new Error('Protection unverified: missing funding transaction or input history');
      hexCharacters += raw.length;
      if (hexCharacters > MAX_HISTORY_HEX_CHARS) throw new Error('Protection verification exceeds history size limit');
      transactions.set(id, parseVerifiedParentTransaction(id, raw));
      raws.set(id, raw);
    }
  };
  const recordOutput = (id: string, index: number) => {
    const output = transactions.get(id)?.outs[index];
    if (!output || output.script.length !== 22 || output.script[0] !== 0 || output.script[1] !== 20)
      throw new Error('Protection unverified: requires Native SegWit funding');
    const destination = address.fromOutputScript(output.script);
    if (!confirmations.has(id)) confirmations.set(id, new Set());
    confirmations.get(id)!.add(destination);
    return { output, destination };
  };
  const verify = async (id: string, depth: number, selected: FundingInput): Promise<number> => {
    if (depth > MAX_DEPTH) throw new Error('Protection verification exceeds ancestry depth limit');
    if (visiting.has(id)) throw new Error('Protection unverified: cyclic funding history');
    const remainingDepth = verified.get(id);
    if (remainingDepth !== undefined) {
      if (depth + remainingDepth > MAX_DEPTH) throw new Error('Protection verification exceeds ancestry depth limit');
      return remainingDepth;
    }
    const tx = transactions.get(id)!;
    if (tx.isCoinbase() || !tx.ins.length || tx.ins.length > MAX_INPUTS)
      throw new Error('Protection unverified: unsupported funding ancestry');
    const modes = tx.ins.map(input => {
      const signature = input.witness[0];
      return input.witness.length === 2 && signature?.length ? signature[signature.length - 1] : undefined;
    });
    const unified = modes.every(mode => mode === 0x21);
    if (!unified && !modes.every(mode => mode === Transaction.SIGHASH_ALL)) throw new UnsupportedFundingSignatures(selected);
    visiting.add(id);
    const parentIds = tx.ins.map(input => Buffer.from(input.hash).reverse().toString('hex'));
    await load(parentIds);
    const request = new Psbt().setVersion(tx.version).setLocktime(tx.locktime);
    tx.ins.forEach((input, index) => {
      const previous = transactions.get(parentIds[index])?.outs[input.index];
      if (!previous) throw new Error('Protection unverified: missing funding input');
      request.addInput({
        hash: input.hash,
        index: input.index,
        sequence: input.sequence,
        witnessUtxo: previous,
        sighashType: unified ? 0x21 : Transaction.SIGHASH_ALL,
      });
    });
    tx.outs.forEach(output => request.addOutput(output));
    const inputValue = request.data.inputs.reduce((total, input) => total + input.witnessUtxo!.value, 0n);
    const outputValue = tx.outs.reduce((total, output) => total + output.value, 0n);
    if (inputValue > 2100000000000000n || outputValue > inputValue) throw new Error('Protection unverified: invalid funding amounts');
    let ancestryDepth = 0;
    if (unified) {
      assertSignedUnifiedTransactionMatchesPsbt(tx.toHex(), request, (key, hash, signature) => ecc.verify(hash, key, signature));
      roots.set(id, tx);
      if (roots.size > MAX_INPUTS) throw new Error('Protection verification exceeds separated funding limit');
    } else {
      assertSignedBtcTransaction(tx.toHex(), request);
      for (let i = 0; i < tx.ins.length; i++) {
        recordOutput(parentIds[i], tx.ins[i].index);
        ancestryDepth = Math.max(ancestryDepth, 1 + (await verify(parentIds[i], depth + 1, selected)));
      }
    }
    visiting.delete(id);
    verified.set(id, ancestryDepth);
    return ancestryDepth;
  };
  const ids = [...new Set(inputs.map(input => input.txid))];
  await load(ids);
  for (const input of inputs) {
    const { output, destination } = recordOutput(input.txid, input.vout);
    if (!Number.isSafeInteger(input.value) || input.value <= 0 || output.value !== BigInt(input.value))
      throw new Error('Protection unverified: funding output mismatch');
    if (input.address !== destination) throw new Error('Protection unverified: funding address mismatch');
    await verify(input.txid, 0, input);
  }
  const addresses = [...new Set([...confirmations.values()].flatMap(values => [...values]))];
  const histories = await source.history(addresses);
  const tip = await source.tip();
  if (tip === null || !Number.isSafeInteger(tip)) throw new Error('Protection unverified: current XBT tip unavailable');
  for (const [id, destinations] of confirmations) {
    for (const destination of destinations) {
      const entries = histories[destination]?.filter(entry => entry.tx_hash === id);
      if (
        !entries?.length ||
        entries.some(
          entry =>
            !Number.isSafeInteger(entry.height) ||
            entry.height < ACTIVATION ||
            tip - entry.height + 1 < 6 ||
            entry.height !== entries[0].height,
        )
      )
        throw new Error('Protection unverified: funding ancestry needs six XBT confirmations');
    }
  }
  if (!source.separation) throw new Error('Protection unverified: separation verifier unavailable');
  await source.separation([...roots.values()]);
  // PSBTs contain their immediate funding transactions, not the entire ancestry.
  return { checkedAt: Date.now(), parents: Object.fromEntries(ids.map(id => [id, raws.get(id)!])) };
}

export function requestFundingInputs(request: Psbt): FundingInput[] {
  return request.txInputs.map((input, index) => {
    const output = request.data.inputs[index]?.witnessUtxo;
    if (!output || output.value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Missing exact input value');
    return {
      txid: Buffer.from(input.hash).reverse().toString('hex'),
      vout: input.index,
      value: Number(output.value),
      address: address.fromOutputScript(output.script),
    };
  });
}

export function assertStandardHardwareResult(hex: string, request: Psbt): Transaction {
  if (request.data.inputs.some(input => input.sighashType !== Transaction.SIGHASH_ALL))
    throw new Error('Standard mode requires SIGHASH_ALL 0x01');
  requestFundingInputs(request).forEach((input, index) => {
    const raw = request.data.inputs[index].nonWitnessUtxo;
    if (!raw) throw new Error('Standard mode requires complete funding transactions');
    const output = parseVerifiedParentTransaction(input.txid, Buffer.from(raw).toString('hex')).outs[input.vout];
    if (!output || output.value !== BigInt(input.value) || address.fromOutputScript(output.script) !== input.address)
      throw new Error('Funding transaction changed');
  });
  return assertSignedBtcTransaction(hex, request);
}

/** Reattach the reviewed input data before validating every returned signature. */
export function combineStandardHardwareResult(request: Psbt, signed: Psbt): Transaction {
  const combined = request.clone().combine(signed);
  combined.data.inputs.forEach((input, index) => {
    if (!input.finalScriptWitness) combined.finalizeInput(index);
  });
  return assertStandardHardwareResult(combined.extractTransaction().toHex(), request);
}
