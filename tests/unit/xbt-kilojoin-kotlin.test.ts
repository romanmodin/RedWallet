import ecc from '../../blue_modules/noble_ecc';
import vectors from './fixtures/kilojoin-kotlin-signatures.json';
import { Coin, plan, transaction, verifySignature, assemble, outpoint } from '../../class/xbt/kilojoin/transaction';
test.each(vectors)('verifies actual pinned Kotlin $type signatures', vector => {
  const type = vector.type as Coin['type'];
  const output = (n: number) => (type === 'p2wpkh' ? '0014' + n.toString(16).repeat(40) : '5120' + n.toString(16).repeat(64));
  const coins: Coin[] = [1, 2].map(n => ({
    txid: n.toString(16).repeat(64),
    vout: 0,
    value: 50000,
    type,
    pubkey: Buffer.from(ecc.pointFromScalar(Buffer.from(n.toString(16).padStart(64, '0'), 'hex'), true)!).toString('hex'),
  }));
  const value = type === 'p2wpkh' ? 39729 : 39702;
  const p = plan(
    coins,
    [output(5), output(6)],
    [
      { script: output(3), value },
      { script: output(4), value },
    ],
    10000,
  );
  expect(transaction(p).getId()).toBe(vector.txid);
  vector.signatures.forEach((sig, index) => expect(verifySignature(p, index, sig)).toBe(true));
  expect(assemble(p, new Map(coins.map((c, i) => [outpoint(c), vector.signatures[i]])))).toBeTruthy();
});
