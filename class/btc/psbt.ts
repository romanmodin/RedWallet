import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { assertBitcoinPayment } from '../../blue_modules/BtcElectrum';

const same = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/** Validate even finalized PSBTs, whose inputs no longer carry partial signatures. */
export function assertSignedBtcTransaction(hex: string, request: bitcoin.Psbt): bitcoin.Transaction {
  const tx = bitcoin.Transaction.fromHex(hex);
  const unsigned = tx.clone();
  for (const input of unsigned.ins) {
    if (input.script.length) throw new Error('Only native SegWit BTC inputs are supported.');
    input.witness = [];
  }
  if (!same(unsigned.toBuffer(), request.data.globalMap.unsignedTx.toBuffer()))
    throw new Error('Signed BTC transaction changed the reviewed recipient, amount, inputs, sequence or locktime.');
  assertBitcoinPayment(hex);
  tx.ins.forEach((input, index) => {
    const previous = request.data.inputs[index]?.witnessUtxo;
    const [signature, pubkey] = input.witness;
    if (!previous || input.witness.length !== 2 || !signature || pubkey?.length !== 33)
      throw new Error('Missing BTC Native SegWit signature or input value.');
    const witness = bitcoin.payments.p2wpkh({ pubkey }).output;
    if (!witness || !same(witness, previous.script)) throw new Error('BTC signature key does not own the reviewed input.');
    const decoded = bitcoin.script.signature.decode(signature);
    if (decoded.hashType !== bitcoin.Transaction.SIGHASH_ALL) throw new Error('BTC requires standard SIGHASH_ALL signatures.');
    const script = bitcoin.payments.p2pkh({ pubkey }).output!;
    const digest = tx.hashForWitnessV0(index, script, previous.value, decoded.hashType);
    if (!ecc.verify(digest, pubkey, decoded.signature)) throw new Error('Invalid BTC signature.');
  });
  return tx;
}

export function btcSigningReview(request: bitcoin.Psbt, owns: (address: string) => boolean): string {
  const inputValue = request.data.inputs.reduce((sum, input) => {
    if (!input.witnessUtxo) throw new Error('Cannot verify BTC input value.');
    return sum + input.witnessUtxo.value;
  }, 0n);
  const outputValue = request.txOutputs.reduce((sum, output) => sum + output.value, 0n);
  const fee = inputValue - outputValue;
  if (fee < 0n || inputValue > 2_100_000_000_000_000n) throw new Error('Invalid BTC transaction amounts.');
  return [
    'BTC · SHA-256',
    ...request.txOutputs.map(output => {
      const address = bitcoin.address.fromOutputScript(output.script);
      return (owns(address) ? 'Your wallet / change: ' : 'Recipient: ') + address + '\n' + output.value.toString() + ' sats';
    }),
    'Network fee: ' + fee.toString() + ' sats',
    'Verify the recipient, amounts and fee on your signing device.',
  ].join('\n\n');
}
