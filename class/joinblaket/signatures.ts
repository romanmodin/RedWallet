import { Transaction, crypto, script } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { unifiedSegwitV0SighashAll } from '../xbt/unified-sighash';
import { checkMinerFee, sats } from './fees';

export type SpentCoin = Readonly<{ txid: string; vout: number; value: number; scriptPubKey: string }>;
export type MakerWitness = Readonly<{ index: number; maker: string; signature: string; publicKey: string }>;
function hex(text: string): Buffer {
  if (typeof text !== 'string' || !/^(?:[0-9a-f]{2})+$/i.test(text)) throw new Error('Invalid hexadecimal data');
  return Buffer.from(text, 'hex');
}
function checkedTransaction(unsignedHex: string, coins: readonly SpentCoin[]): Transaction {
  if (typeof unsignedHex !== 'string' || unsignedHex.length > 200_000 || !coins.length || coins.length > 128)
    throw new Error('Invalid transaction size');
  const tx = Transaction.fromBuffer(hex(unsignedHex));
  if (tx.version !== 2 || tx.ins.length !== coins.length || !tx.outs.length || tx.outs.length > 128)
    throw new Error('Invalid JoinBlaket transaction');
  const seen = new Set<string>();
  tx.ins.forEach((input, index) => {
    const c = coins[index];
    if (!Number.isInteger(c.vout) || c.vout < 0 || c.vout > 0xffffffff) throw new Error('Invalid output index');
    const key = Buffer.from(input.hash).reverse().toString('hex') + ':' + input.index;
    if (typeof c.txid !== 'string' || !/^[0-9a-f]{64}$/i.test(c.txid) || key !== c.txid.toLowerCase() + ':' + c.vout || seen.has(key))
      throw new Error('Prevout mismatch or duplicate');
    seen.add(key);
    if (input.script.length || input.witness.length || input.sequence !== (tx.locktime ? 0xfffffffe : 0xffffffff))
      throw new Error('Unexpected script, witness or sequence');
    if (!/^0014[0-9a-f]{40}$/i.test(c.scriptPubKey)) throw new Error('Only P2WPKH prevouts are supported');
    sats(c.value);
  });
  const totalIn = coins.reduce((sum, c) => sats(sum + c.value), 0);
  const totalOut = tx.outs.reduce((sum, o) => sats(sum + sats(Number(o.value))), 0);
  checkMinerFee(totalIn, totalOut, tx.ins.length, tx.outs.length);
  return tx;
}
export function makerInputDigest(unsignedHex: string, coins: readonly SpentCoin[], index: number, publicKeyHex: string): Buffer {
  const tx = checkedTransaction(unsignedHex, coins);
  if (!Number.isInteger(index) || index < 0 || index >= coins.length) throw new Error('Invalid input index');
  const pub = hex(publicKeyHex);
  const spent = hex(coins[index].scriptPubKey);
  if (pub.length !== 33 || !ecc.isPoint(pub) || !Buffer.from(crypto.hash160(pub)).equals(spent.subarray(2)))
    throw new Error('Key does not own input');
  const code = Buffer.concat([Buffer.from('76a914', 'hex'), spent.subarray(2), Buffer.from('88ac', 'hex')]);
  return unifiedSegwitV0SighashAll(
    tx,
    index,
    coins.map(c => ({ value: BigInt(c.value), script: hex(c.scriptPubKey) })),
    code,
  );
}
// This checks cryptography against caller-supplied prevouts. Those must first be
// authenticated by SPV/unspent checks and bound to the explicitly approved plan.
// No private keys, signing or broadcast are exposed by this module.
export function verifyMakerWitness(unsignedHex: string, coins: readonly SpentCoin[], witness: MakerWitness): boolean {
  try {
    const encoded = hex(witness.signature);
    if (encoded.length < 9 || encoded.length > 73 || encoded[encoded.length - 1] !== 0x21) return false;
    const digest = makerInputDigest(unsignedHex, coins, witness.index, witness.publicKey);
    encoded[encoded.length - 1] = 0x01; // bitcoinjs DER decoder does not recognize 0x21.
    const compact = script.signature.decode(encoded).signature;
    return ecc.verify(digest, hex(witness.publicKey), compact, true);
  } catch (_) {
    return false;
  }
}
export function verifyAllMakerWitnesses(
  unsignedHex: string,
  coins: readonly SpentCoin[],
  owners: readonly string[],
  witnesses: readonly MakerWitness[],
): void {
  checkedTransaction(unsignedHex, coins);
  if (owners.length !== coins.length || owners.some(o => !o) || !owners.includes('taker')) throw new Error('Invalid input ownership');
  const makerIndices = owners.map((o, i) => (o !== 'taker' ? i : -1)).filter(i => i >= 0);
  if (!makerIndices.length || witnesses.length !== makerIndices.length) throw new Error('Every maker input requires one signature');
  const seen = new Set<number>();
  for (const witness of witnesses) {
    if (
      !makerIndices.includes(witness.index) ||
      seen.has(witness.index) ||
      owners[witness.index] !== witness.maker ||
      !verifyMakerWitness(unsignedHex, coins, witness)
    )
      throw new Error('Missing, duplicate or invalid maker signature');
    seen.add(witness.index);
  }
}
