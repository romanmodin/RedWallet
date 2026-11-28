import type { Psbt } from 'bitcoinjs-lib';
import type { collectMinedXbtEvidence } from './mined-ancestry-evidence';

import { verifyPublicMinedSeparation } from './separation-service';
import { requestFundingInputs } from './standard-hardware';
import { parseVerifiedParentTransaction } from './verified-transaction';

type Outpoint = { txid: string; vout: number };
type Tip = { height: number; hash: string };
type ReadTip = (signal: AbortSignal) => Promise<Tip>;
type Evidence = { path: readonly string[]; height: number; xbtReward: Awaited<ReturnType<typeof collectMinedXbtEvidence>> };

// Qualification entry point. Call again with freshly collected evidence before
// submission. The independent tip reader is supplied separately from the history source.
export async function verifyMinedRequestFunding(
  request: Psbt,
  collect: (point: Outpoint) => Promise<Evidence>,
  readTrustedTip: ReadTip,
  assertAuthorized: () => void,
): Promise<void> {
  assertAuthorized();
  if (request.inputCount < 1 || request.inputCount > 64) throw new Error('Expected 1–64 selected inputs');
  const reviewed = request.toBase64();
  const inputs = requestFundingInputs(request);
  const scripts = request.data.inputs.map(input => Buffer.from(input.witnessUtxo!.script));
  let anchor: Tip | undefined;
  const consistentTip: ReadTip = async signal => {
    const { height, hash } = await readTrustedTip(signal);
    if (anchor && (height !== anchor.height || hash !== anchor.hash)) throw new Error('XBT tip changed during funding verification');
    anchor = { height, hash };
    return anchor;
  };
  for (const [index, input] of inputs.entries()) {
    assertAuthorized();
    const point = { txid: input.txid, vout: input.vout };
    const evidence = await collect({ ...point });
    assertAuthorized();
    const first = evidence.path[0];
    if (typeof first !== 'string' || !first.length || first.length > 2_000_000) throw new Error('Missing selected funding transaction');
    const output = parseVerifiedParentTransaction(point.txid, first).outs[point.vout];
    if (
      !output ||
      input.value <= 0 ||
      output.value !== BigInt(input.value) ||
      output.script.length !== 22 ||
      output.script[0] !== 0 ||
      output.script[1] !== 20 ||
      !scripts[index].equals(output.script)
    )
      throw new Error('Selected funding output does not match the reviewed Native SegWit input');
    await verifyPublicMinedSeparation(point, evidence.path, evidence.height, evidence.xbtReward, consistentTip, assertAuthorized);
  }
  assertAuthorized();
  if (request.toBase64() !== reviewed) throw new Error('Reviewed request changed during funding verification');
}
