import { address } from 'bitcoinjs-lib';
import {
  BondProof,
  bondValue,
  freezeScript,
  normalizeRelativeFee,
  parseOffer,
  parseOrderbook,
  pushNumber,
} from '../../class/joinblaket/offers';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';
const v = vectors.offer,
  proof = () => BondProof.decode(v.proof_b64)!;
test('signed maker offer and bond proof match rc6 vectors', () => {
  const result = parseOrderbook([{ type: 685, line: v.privmsg_line }], v.taker_nick);
  expect(result.heard).toBe(1);
  expect(result.dropped).toBe(0);
  const { offer, bond } = result.offers[0];
  expect(offer).toEqual({ ...v.parsed_offer, type: v.parsed_offer.ordertype, ordertype: undefined, bondProof: v.proof_b64 });
  expect(bond.expiryHeight).toBe(v.parsed_bond.cert_expiry);
  expect(bond.redeemScript).toBe(v.freeze_script);
  expect(bond.scriptPubKey).toBe(v.bond_p2wsh_scriptpubkey);
  expect(address.fromOutputScript(Buffer.from(bond.scriptPubKey, 'hex'))).toBe(v.bond_address);
  expect(bond.verify(v.maker_nick, v.taker_nick)).toBe(true);
  expect(bond.verify(v.maker_nick, v.maker_nick)).toBe(false);
});
test('proof fields, expiry and script numbers match upstream', () => {
  const b = proof(),
    f = v.proof_fields;
  expect(b.nickSignature).toBe(f.nick_sig_padded);
  expect(b.certificateSignature).toBe(f.cert_sig_padded);
  expect(b.certificateKey).toBe(f.cert_pub);
  expect(b.utxoKey).toBe(f.utxo_pub);
  expect(b.txid).toBe(f.txid_display);
  expect(b.vout).toBe(f.vout);
  expect(b.locktime).toBe(f.locktime);
  expect(b.expiredAt(b.expiryHeight)).toBe(false);
  expect(b.expiredAt(b.expiryHeight + 1)).toBe(true);
  for (const [n, hex] of [
    [0, '00'],
    [-1, '4f'],
    [16, '60'],
    [17, '0111'],
    [128, '028000'],
    [0x80000000, '050000008000'],
  ] as const)
    expect(pushNumber(n).toString('hex')).toBe(hex);
});
test('offer parsing normalizes fees and rejects malformed or oversized data', () => {
  expect(normalizeRelativeFee('1E-5')).toBe('0.00001');
  expect(normalizeRelativeFee('1.00E-4')).toBe('0.000100');
  expect(parseOffer('sw0absoffer 1 27300 100000 0 500', v.maker_nick)?.cjfee).toBe('500');
  for (const s of [
    'sw0reloffer 1 27300 100000 0',
    'sw0reloffer 1 27300 100000 0 -0.1',
    'sw0reloffer 1 27300 100000 -5 0.1',
    'sw0reloffer 1 27300 100000 0 1E-9999',
    'sw0absoffer 1 27300 100000 0 0.5',
    'sw0relofferjunk 1 27300 100000 0 0.0002',
    'sw0reloffer 1 100000 27300 0 0.0002',
    'sw0reloffer 9007199254740992 1 100000 0 0.0002',
    'sw0reloffer 1 1 100000 0 0.0002!tbond x!tbond y',
    'x'.repeat(60001),
  ])
    expect(parseOffer(s, v.maker_nick)).toBeNull();
});
test('unbound outpoint/locktime fields require independent chain validation', () => {
  const raw = Buffer.from(v.proof_b64, 'base64');
  raw[248] += 1;
  const changed = BondProof.decode(raw.toString('base64'))!;
  expect(changed.verify(v.maker_nick, v.taker_nick)).toBe(true);
  expect(changed.scriptPubKey).not.toBe(proof().scriptPubKey);
});
test('rejects bad certificate, non-ff padding, invalid proof size and unauthenticated offers', () => {
  const raw = Buffer.from(v.proof_b64, 'base64');
  for (const index of [0, 72, 177]) {
    const altered = Buffer.from(raw);
    altered[index] = 0;
    expect(BondProof.decode(altered.toString('base64'))!.verify(v.maker_nick, v.taker_nick)).toBe(false);
  }
  expect(BondProof.decode(Buffer.from(raw.subarray(0, 251)).toString('base64'))).toBeNull();
  expect(BondProof.decode(v.proof_b64 + '\n')).toBeNull();
  expect(parseOrderbook([{ type: 685, line: v.privmsg_line.replace('2500000000', '2500000001') }], v.taker_nick).offers).toHaveLength(0);
  expect(parseOrderbook([{ type: 685, line: v.privmsg_line }], v.maker_nick).offers).toHaveLength(0);
  expect(parseOrderbook([{ type: 687, line: v.privmsg_line.replace(v.taker_nick + '!', 'PUBLIC!') }], v.taker_nick).offers).toHaveLength(0);
});
test('deduplicates the same maker/offer and preserves read-only proof classification', () => {
  const result = parseOrderbook(
    [
      { type: 685, line: v.privmsg_line },
      { type: 685, line: v.privmsg_line },
    ],
    v.taker_nick,
  );
  expect(result.offers).toHaveLength(1);
  expect(result.dropped).toBe(1);
  expect(Object.isFrozen(result.offers[0].bond)).toBe(true);
});
test('bond value matches upstream and remains distinct from monetary amounts', () => {
  const p = v.bond_value_inputs;
  expect(bondValue(p.utxo_value, p.confirmation_time, p.locktime, p.current_time)).toBe(BigInt(v.bond_value));
  expect(bondValue(100000000, 1760000000, 1798761600, 4294967295)).toBe(0n);
  expect(bondValue(2100000000000000, 0, 0xffffffff, 0)).toBe(0x7fffffffffffffffn);
  expect(() => bondValue(-1, 1, 2, 1)).toThrow();
  expect(() => freezeScript('02' + 'ff'.repeat(32), 1)).toThrow();
});
