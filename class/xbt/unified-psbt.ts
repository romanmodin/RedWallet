import { Psbt, Transaction, crypto, script } from 'bitcoinjs-lib';

import { SpentOutput, unifiedSegwitV0SighashAll } from './unified-sighash';

export type UnifiedSigner = {
  publicKey: Uint8Array;
  sign: (messageHash: Uint8Array) => Uint8Array;
};

export type UnifiedSignatureVerifier = (publicKey: Uint8Array, messageHash: Uint8Array, signature: Uint8Array) => boolean;

export const SIGHASH_ALL_UNIFIED = 0x21;
const STANDARD_SIGHASH_ALL = 0x01;

function buildUnsignedTransaction(psbt: Psbt): Transaction {
  const transaction = new Transaction();
  transaction.version = psbt.version;
  transaction.locktime = psbt.locktime;
  for (const input of psbt.txInputs) {
    transaction.addInput(Buffer.from(input.hash), input.index, input.sequence);
  }
  for (const output of psbt.txOutputs) {
    transaction.addOutput(Buffer.from(output.script), output.value);
  }
  return transaction;
}

function isP2wpkhScript(outputScript: Uint8Array): boolean {
  return outputScript.length === 22 && outputScript[0] === 0x00 && outputScript[1] === 0x14;
}

function getSpentOutputs(psbt: Psbt): SpentOutput[] {
  if (psbt.data.inputs.length === 0 || psbt.data.inputs.length !== psbt.txInputs.length) {
    throw new Error('PSBT input data does not match its unsigned transaction');
  }

  return psbt.data.inputs.map(input => {
    const witnessUtxo = input.witnessUtxo;
    if (!witnessUtxo || !isP2wpkhScript(witnessUtxo.script)) {
      throw new Error('Unified signing requires a P2WPKH witness UTXO for every input');
    }
    const rawValue = witnessUtxo.value;
    if (typeof rawValue !== 'bigint' && typeof rawValue !== 'number') {
      throw new Error('Spent output amount must be an integer');
    }
    if (typeof rawValue === 'number' && !Number.isSafeInteger(rawValue)) {
      throw new Error('Spent output amount is not an exact integer');
    }
    const value = BigInt(rawValue);
    if (value < 0n || value > 0x7fffffffffffffffn) {
      throw new Error('Spent output amount is outside int64 range');
    }
    return { value, script: Buffer.from(witnessUtxo.script) };
  });
}

function getScriptCode(prevoutScript: Uint8Array): Buffer {
  if (!isP2wpkhScript(prevoutScript)) throw new Error('Unified signing only supports native P2WPKH inputs');
  return Buffer.concat([Buffer.from([0x76, 0xa9, 0x14]), Buffer.from(prevoutScript).subarray(2), Buffer.from([0x88, 0xac])]);
}

function getUnifiedDigest(psbt: Psbt, inputIndex: number, scriptCode: Uint8Array): Buffer {
  if (!Number.isInteger(inputIndex) || inputIndex < 0 || inputIndex >= psbt.data.inputs.length) {
    throw new Error('Input index is outside the PSBT');
  }
  const transaction = buildUnsignedTransaction(psbt);
  const spentOutputs = getSpentOutputs(psbt);
  return unifiedSegwitV0SighashAll(transaction, inputIndex, spentOutputs, scriptCode);
}

function getInputSignature(psbt: Psbt, inputIndex: number, publicKey: Uint8Array) {
  const input = psbt.data.inputs[inputIndex];
  if (!input) throw new Error('Input index is outside the PSBT');
  if (input.sighashType !== SIGHASH_ALL_UNIFIED) {
    throw new Error('Input does not declare SIGHASH_ALL | SIGHASH_UNIFIED');
  }
  const signatures = input.partialSig || [];
  if (signatures.length !== 1 || Buffer.compare(Buffer.from(signatures[0].pubkey), Buffer.from(publicKey)) !== 0) {
    throw new Error('Expected exactly one P2WPKH signature for the supplied public key');
  }
  const encodedSignature = Buffer.from(signatures[0].signature);
  if (encodedSignature.length < 2 || encodedSignature[encodedSignature.length - 1] !== SIGHASH_ALL_UNIFIED) {
    throw new Error('Signature does not use SIGHASH_ALL | SIGHASH_UNIFIED');
  }
  // bitcoinjs-lib rejects hash type 0x21 in its decoder. Decode the standard DER
  // body using SIGHASH_ALL, then pass the resulting compact signature onward.
  const standardEncodedSignature = Buffer.from(encodedSignature);
  standardEncodedSignature[standardEncodedSignature.length - 1] = STANDARD_SIGHASH_ALL;
  return {
    encodedSignature,
    compactSignature: script.signature.decode(standardEncodedSignature).signature,
  };
}

function serializeP2wpkhWitness(signature: Uint8Array, publicKey: Uint8Array): Buffer {
  if (signature.length > 252 || publicKey.length > 252) {
    throw new Error('Witness element is too large for this P2WPKH finalizer');
  }
  return Buffer.concat([
    Buffer.from([0x02, signature.length]),
    Buffer.from(signature),
    Buffer.from([publicKey.length]),
    Buffer.from(publicKey),
  ]);
}

/**
 * Signs one native P2WPKH input with XBT Unified Sighash.
 * The caller must verify all PSBT UTXO data against trusted wallet/node state before signing.
 * The function deliberately bypasses bitcoinjs-lib's standard signInput method, which does
 * not support hash type 0x21.
 */
export function signUnifiedP2wpkhInput(psbt: Psbt, inputIndex: number, signer: UnifiedSigner): Psbt {
  const input = psbt.data.inputs[inputIndex];
  const witnessUtxo = input?.witnessUtxo;
  const publicKey = Buffer.from(signer.publicKey);
  if (!input || !witnessUtxo) throw new Error('P2WPKH witness UTXO is required for signing');
  if (input.finalScriptSig || input.finalScriptWitness || input.partialSig?.length) {
    throw new Error('Refusing to sign an input that already contains signatures');
  }
  if (input.sighashType !== undefined && input.sighashType !== SIGHASH_ALL_UNIFIED) {
    throw new Error('Input declares an incompatible sighash type');
  }
  const scriptCode = getScriptCode(witnessUtxo.script);
  const publicKeyHash = Buffer.from(witnessUtxo.script).subarray(2);
  if (publicKey.length !== 33 || Buffer.compare(Buffer.from(crypto.hash160(publicKey)), publicKeyHash) !== 0) {
    throw new Error('Signing key does not match the P2WPKH witness UTXO');
  }
  const digest = getUnifiedDigest(psbt, inputIndex, scriptCode);
  const compactSignature = Buffer.from(signer.sign(digest));
  if (compactSignature.length !== 64) throw new Error('Signer must return a 64-byte compact ECDSA signature');
  const encodedSignature = Buffer.from(script.signature.encode(compactSignature, STANDARD_SIGHASH_ALL));
  encodedSignature[encodedSignature.length - 1] = SIGHASH_ALL_UNIFIED;
  psbt.data.updateInput(inputIndex, {
    ...(input.sighashType === undefined ? { sighashType: SIGHASH_ALL_UNIFIED } : {}),
    partialSig: [{ pubkey: publicKey, signature: encodedSignature }],
  });
  return psbt;
}

/** Validates the custom digest and signature without bitcoinjs-lib's Bitcoin-only sighash decoder. */
export function validateUnifiedP2wpkhInput(
  psbt: Psbt,
  inputIndex: number,
  publicKey: Uint8Array,
  verifier: UnifiedSignatureVerifier,
): boolean {
  const input = psbt.data.inputs[inputIndex];
  const witnessUtxo = input?.witnessUtxo;
  if (!input || !witnessUtxo) throw new Error('P2WPKH witness UTXO is required for validation');
  const scriptCode = getScriptCode(witnessUtxo.script);
  const keyHash = Buffer.from(witnessUtxo.script).subarray(2);
  if (Buffer.compare(Buffer.from(crypto.hash160(publicKey)), keyHash) !== 0)
    throw new Error('Public key does not match the P2WPKH witness UTXO');
  const { encodedSignature, compactSignature } = getInputSignature(psbt, inputIndex, publicKey);
  const digest = getUnifiedDigest(psbt, inputIndex, scriptCode);
  return verifier(publicKey, digest, compactSignature) && encodedSignature[encodedSignature.length - 1] === SIGHASH_ALL_UNIFIED;
}

/** Validates and finalizes one native P2WPKH input into its two-item witness. */
export function finalizeUnifiedP2wpkhInput(
  psbt: Psbt,
  inputIndex: number,
  publicKey: Uint8Array,
  verifier: UnifiedSignatureVerifier,
): Psbt {
  const witnessUtxo = psbt.data.inputs[inputIndex]?.witnessUtxo;
  if (!witnessUtxo) throw new Error('P2WPKH witness UTXO is required for finalization');
  if (!validateUnifiedP2wpkhInput(psbt, inputIndex, publicKey, verifier)) {
    throw new Error('Unified P2WPKH signature validation failed');
  }
  const { encodedSignature } = getInputSignature(psbt, inputIndex, publicKey);
  psbt.data.updateInput(inputIndex, {
    finalScriptWitness: serializeP2wpkhWitness(encodedSignature, publicKey),
  });
  psbt.data.clearFinalizedInput(inputIndex);
  return psbt;
}

/** Verify an external signer's result against the exact reviewed PSBT and its prevouts. */
export function assertSignedUnifiedTransactionMatchesPsbt(hex: string, expected: Psbt, verifier: UnifiedSignatureVerifier): void {
  const signed = Transaction.fromHex(hex);
  const stripped = signed.clone();
  for (const input of stripped.ins) input.witness = [];
  if (stripped.toHex() !== buildUnsignedTransaction(expected).toHex()) {
    throw new Error('External signer changed the reviewed transaction');
  }
  const spentOutputs = getSpentOutputs(expected);
  signed.ins.forEach((input, index) => {
    if (input.script.length || input.witness.length !== 2) throw new Error('External signer must return native P2WPKH signatures');
    const [encodedSignature, publicKey] = input.witness;
    if (
      publicKey.length !== 33 ||
      Buffer.compare(Buffer.from(crypto.hash160(publicKey)), Buffer.from(spentOutputs[index].script).subarray(2)) !== 0
    ) {
      throw new Error('External signing key does not match the reviewed input');
    }
    if (!encodedSignature.length || encodedSignature[encodedSignature.length - 1] !== SIGHASH_ALL_UNIFIED) {
      throw new Error('External signer did not use XBT Unified Sighash 0x21');
    }
    const standardEncoded = Uint8Array.from(encodedSignature);
    standardEncoded[standardEncoded.length - 1] = STANDARD_SIGHASH_ALL;
    const compact = script.signature.decode(standardEncoded).signature;
    const digest = unifiedSegwitV0SighashAll(signed, index, spentOutputs, getScriptCode(spentOutputs[index].script));
    if (!verifier(publicKey, digest, compact)) throw new Error('External Unified signature is invalid');
  });
}
