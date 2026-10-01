import { Transaction, script } from 'bitcoinjs-lib';
import { SIGHASH_ALL_UNIFIED } from './unified-psbt';

/** The supported XBT signer emits native P2WPKH inputs with Unified Sighash only. */
export function assertXbtUnifiedTransaction(hex: string): void {
  const transaction = Transaction.fromHex(hex);
  if (!transaction.ins.length || !transaction.outs.length) throw new Error('XBT broadcast requires a signed payment');
  for (const input of transaction.ins) {
    if (input.script.length || input.witness.length !== 2) {
      throw new Error('XBT broadcast requires native P2WPKH Unified signatures on every input');
    }
    const [signature, publicKey] = input.witness;
    if (!signature.length || signature[signature.length - 1] !== SIGHASH_ALL_UNIFIED) {
      throw new Error('XBT broadcast refuses a signature without SIGHASH_ALL | SIGHASH_UNIFIED');
    }
    if (publicKey.length !== 33 || (publicKey[0] !== 0x02 && publicKey[0] !== 0x03)) {
      throw new Error('XBT broadcast requires compressed P2WPKH public keys');
    }
    // bitcoinjs's DER decoder recognizes standard hash types; validate the DER
    // encoding after separately requiring the actual Unified flag above.
    const standardEncodedSignature = Uint8Array.from(signature);
    standardEncodedSignature[standardEncodedSignature.length - 1] = Transaction.SIGHASH_ALL;
    script.signature.decode(standardEncodedSignature);
  }
}
