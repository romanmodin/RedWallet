import { Psbt, payments } from 'bitcoinjs-lib';

import { SpentOutput, unifiedTaprootKeyPathSighashAll } from './unified-sighash';
import { buildUnsignedTransaction, SIGHASH_ALL_UNIFIED, UnifiedSigner, UnifiedSignatureVerifier } from './unified-psbt';

function getSpentOutputs(psbt: Psbt): SpentOutput[] {
  if (!psbt.data.inputs.length || psbt.data.inputs.length !== psbt.txInputs.length) {
    throw new Error('PSBT input data does not match its unsigned transaction');
  }
  return psbt.data.inputs.map(input => {
    const output = input.witnessUtxo;
    if (!output || output.script.length !== 34 || output.script[0] !== 0x51 || output.script[1] !== 0x20) {
      throw new Error('Unified Taproot signing requires a P2TR witness UTXO for every input');
    }
    if (typeof output.value !== 'bigint' || output.value < 0n || output.value > 0x7fffffffffffffffn) {
      throw new Error('Spent output amount is outside int64 range');
    }
    return { value: output.value, script: output.script };
  });
}

function getKeyPathInput(psbt: Psbt, index: number) {
  if (!Number.isInteger(index) || index < 0 || index >= psbt.data.inputs.length) throw new Error('Input index is outside the PSBT');
  const input = psbt.data.inputs[index];
  if (input.tapLeafScript?.length || input.tapScriptSig?.length || input.tapMerkleRoot || input.redeemScript || input.witnessScript) {
    throw new Error('Only BIP86 Taproot key-path inputs are supported');
  }
  if (input.finalScriptSig || input.finalScriptWitness || input.partialSig?.length) {
    throw new Error('Refusing an already finalized or non-Taproot input');
  }
  if (!input.tapInternalKey || input.tapInternalKey.length !== 32 || !input.witnessUtxo) {
    throw new Error('Taproot internal key and witness UTXO are required');
  }
  const expected = payments.p2tr({ internalPubkey: input.tapInternalKey }).output!;
  if (!Buffer.from(expected).equals(Buffer.from(input.witnessUtxo.script))) {
    throw new Error('Taproot internal key does not match the witness UTXO');
  }
  return input;
}

/** The caller must authenticate all prevouts and change against local wallet state. */
export function signUnifiedTaprootInput(psbt: Psbt, index: number, signer: UnifiedSigner): Psbt {
  const input = getKeyPathInput(psbt, index);
  const spentOutputs = getSpentOutputs(psbt);
  if (input.tapKeySig) throw new Error('Refusing to overwrite a Taproot signature');
  if (input.sighashType !== undefined && input.sighashType !== SIGHASH_ALL_UNIFIED)
    throw new Error('Input declares an incompatible sighash type');
  if (signer.publicKey.length !== 32 || !Buffer.from(signer.publicKey).equals(Buffer.from(spentOutputs[index].script).subarray(2))) {
    throw new Error('Signing key does not match the Taproot witness UTXO');
  }
  const digest = unifiedTaprootKeyPathSighashAll(buildUnsignedTransaction(psbt), index, spentOutputs);
  const signature = signer.sign(digest);
  if (signature.length !== 64) throw new Error('Signer must return a 64-byte Schnorr signature');
  // Bypass bitcoinjs's Bitcoin-only sighash handling. DEFAULT | UNIFIED (0x20) is invalid.
  psbt.data.updateInput(index, {
    ...(input.sighashType === undefined ? { sighashType: SIGHASH_ALL_UNIFIED } : {}),
    tapKeySig: Buffer.concat([Buffer.from(signature), Buffer.from([SIGHASH_ALL_UNIFIED])]),
  });
  return psbt;
}

export function finalizeUnifiedTaprootInput(psbt: Psbt, index: number, verifier: UnifiedSignatureVerifier): Psbt {
  const input = getKeyPathInput(psbt, index);
  const spentOutputs = getSpentOutputs(psbt);
  const signature = input.tapKeySig;
  if (input.sighashType !== SIGHASH_ALL_UNIFIED || !signature || signature.length !== 65 || signature[64] !== SIGHASH_ALL_UNIFIED) {
    throw new Error('Taproot signature must use SIGHASH_ALL | SIGHASH_UNIFIED');
  }
  const digest = unifiedTaprootKeyPathSighashAll(buildUnsignedTransaction(psbt), index, spentOutputs);
  if (!verifier(spentOutputs[index].script.subarray(2), digest, signature.subarray(0, 64))) {
    throw new Error('Unified Taproot signature is invalid');
  }
  psbt.data.updateInput(index, { finalScriptWitness: Buffer.concat([Buffer.from([1, 65]), Buffer.from(signature)]) });
  psbt.data.clearFinalizedInput(index);
  return psbt;
}
