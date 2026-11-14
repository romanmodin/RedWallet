import { Psbt, Transaction, address } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { assertSignedBtcTransaction } from '../btc/psbt';
import { assertSignedUnifiedTransactionMatchesPsbt } from './unified-psbt';
import { parseVerifiedParentTransaction } from './verified-transaction';

export type FundingInput = { txid: string; vout: number; value: number; address?: string };
export type FundingSource = {
  raw: (ids: string[]) => Promise<Record<string, string>>;
  history: (addresses: string[]) => Promise<Record<string, { tx_hash: string; height: number }[]>>;
  tip: () => Promise<number | null>;
};
export type FundingProof = { checkedAt: number; parents: Record<string, string> };
// Release gate: direct Unified funding is not sufficient cross-chain separation proof.
// A standard-signed witness for the same body has the same txid. Keep disabled until
// a confirmed conflict/chain-exclusive ancestor proof is integrated and rechecked.
export const STANDARD_HARDWARE_RELEASE_ENABLED: boolean = false;
export function assertStandardHardwareReleased(): void {
  if (!STANDARD_HARDWARE_RELEASE_ENABLED) throw new Error('Standard hardware signing is unavailable until coin separation can be verified');
}
const ACTIVATION = 961640;
const MAX_INPUTS = 64;

/** Conservative first version: direct, six-confirmation P2WPKH Unified funding only.
 * This verifies the funding signatures, not a mere trailing flag or server label.
 * It assumes the owner has not separately signed an identical funding tx for BTC.
 * Descendant tracing, coinbase and mixed/Taproot funding are deliberately rejected.
 */
export async function verifyStandardHardwareFunding(inputs: FundingInput[], source: FundingSource): Promise<FundingProof> {
  if (!inputs.length || inputs.length > MAX_INPUTS) throw new Error('Compatibility mode supports 1–64 selected inputs');
  const ids = [...new Set(inputs.map(input => input.txid))];
  const parents = await source.raw(ids);
  const addresses: string[] = [];
  const transactions = new Map<string, Transaction>();
  const ancestors = new Set<string>();
  for (const input of inputs) {
    const raw = parents[input.txid];
    if (!raw || raw.length > 2_000_000) throw new Error('Protection unverified: funding transaction unavailable');
    const tx = parseVerifiedParentTransaction(input.txid, raw);
    const output = tx.outs[input.vout];
    if (!Number.isSafeInteger(input.value) || input.value <= 0 || !output || output.value !== BigInt(input.value))
      throw new Error('Protection unverified: funding output mismatch');
    const destination = address.fromOutputScript(output.script);
    if (input.address !== destination) throw new Error('Protection unverified: funding address mismatch');
    if (tx.isCoinbase() || !tx.ins.length || tx.ins.length > MAX_INPUTS)
      throw new Error('Protection unverified: requires direct Unified funding');
    addresses.push(destination);
    transactions.set(input.txid, tx);
    tx.ins.forEach(previous => ancestors.add(Buffer.from(previous.hash).reverse().toString('hex')));
  }
  if (ancestors.size > 256) throw new Error('Protection verification exceeds ancestor limit');
  const grandparents = await source.raw([...ancestors]);
  if (Object.values(grandparents).reduce((total, raw) => total + (raw?.length || 0), 0) > 16_000_000)
    throw new Error('Protection verification exceeds history size limit');
  for (const tx of transactions.values()) {
    const request = new Psbt().setVersion(tx.version).setLocktime(tx.locktime);
    tx.ins.forEach(input => {
      const id = Buffer.from(input.hash).reverse().toString('hex');
      const raw = grandparents[id];
      if (!raw || raw.length > 2_000_000) throw new Error('Protection unverified: missing funding input history');
      const previous = parseVerifiedParentTransaction(id, raw).outs[input.index];
      if (!previous) throw new Error('Protection unverified: missing funding input');
      request.addInput({ hash: input.hash, index: input.index, sequence: input.sequence, witnessUtxo: previous, sighashType: 0x21 });
    });
    tx.outs.forEach(output => request.addOutput(output));
    assertSignedUnifiedTransactionMatchesPsbt(tx.toHex(), request, (key, hash, signature) => ecc.verify(hash, key, signature));
  }
  const histories = await source.history([...new Set(addresses)]);
  const tip = await source.tip();
  if (tip === null || !Number.isSafeInteger(tip)) throw new Error('Protection unverified: current XBT tip unavailable');
  inputs.forEach((input, index) => {
    const entries = histories[addresses[index]]?.filter(entry => entry.tx_hash === input.txid);
    if (
      !entries?.length ||
      entries.some(entry => !Number.isSafeInteger(entry.height) || entry.height < ACTIVATION || tip - entry.height + 1 < 6)
    )
      throw new Error('Protection unverified: Unified funding needs six XBT confirmations');
  });
  return { checkedAt: Date.now(), parents };
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
