import { ChainLookup, ChainUtxo } from '../../class/joinblaket/chain';
import { signMessage } from '../../class/joinblaket/message-signatures';
import { NickIdentity } from '../../class/joinblaket/nick';
import { BondProof, BondedOffer, parseOrderbook } from '../../class/joinblaket/offers';
import { chooseMakers, valueOffers, ValuedOffer } from '../../class/joinblaket/selection';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';
const v = vectors.offer,
  now = v.bond_value_inputs.current_time,
  tip = 962000;
const original = parseOrderbook([{ type: 685, line: v.privmsg_line }], v.taker_nick).offers[0];
const names = [1, 2, 3, 4].map(i => {
  const id = new NickIdentity(Buffer.from(i.toString(16).padStart(64, '0'), 'hex'));
  try {
    return id.nick;
  } finally {
    id.destroy();
  }
});
function offer(index = 0, tx = index + 1, fee = '0.0002', expiry = original.bond.expiry): BondedOffer {
  const maker = names[index],
    raw = Buffer.from(v.proof_b64, 'base64');
  const pad = (sig: string) => {
    const b = Buffer.from(sig, 'base64');
    return Buffer.concat([Buffer.alloc(72 - b.length, 0xff), b]);
  };
  pad(signMessage(Buffer.from(v.cert_private_key, 'hex'), v.taker_nick + '|' + maker)).copy(raw, 0);
  if (expiry !== original.bond.expiry) {
    raw.writeUInt16LE(expiry, 177);
    const message = Buffer.concat([
      Buffer.from('fidelity-bond-cert|'),
      Buffer.from(v.proof_fields.cert_pub, 'hex'),
      Buffer.from('|' + expiry),
    ]);
    pad(signMessage(Buffer.from(v.bond_private_key, 'hex'), message)).copy(raw, 72);
  }
  Buffer.from(tx.toString(16).padStart(64, '0'), 'hex').copy(raw, 212);
  return { offer: { ...original.offer, counterparty: maker, cjfee: fee }, bond: BondProof.decode(raw.toString('base64'))! };
}
function chain(modify: Partial<ChainUtxo> = {}) {
  const height = jest.fn(async () => tip);
  const utxo = jest.fn(
    async (txid: string, vout: number, scriptPubKey?: string): Promise<ChainUtxo | null> => ({
      txid,
      vout,
      scriptPubKey: scriptPubKey!,
      value: v.bond_value_inputs.utxo_value,
      height: tip - 9,
      confirmations: 10,
      blockTime: v.bond_value_inputs.confirmation_time,
      blockHash: '00'.repeat(32),
      confirmationProof: 'anchored-merkle-pow',
      unspentSource: 'electrum',
      ...modify,
    }),
  );
  return { height, utxo };
}
const valued = (o: BondedOffer, value = 10n): ValuedOffer => ({ ...o, value });
test('bond chain valuation matches the pinned economic weight and caches identical claims', async () => {
  const c = chain(),
    a = offer(),
    b = { ...a, offer: { ...a.offer, oid: a.offer.oid + 1 } };
  const out = await valueOffers([a, b], c, v.taker_nick, now);
  expect(out.map(x => x.value)).toEqual([BigInt(v.bond_value), BigInt(v.bond_value)]);
  expect(c.utxo).toHaveBeenCalledTimes(1);
  expect(Object.isFrozen(out[0].offer)).toBe(true);
});
test('certificate expiry is checked per offer, outside the shared outpoint cache', async () => {
  const c = chain(),
    good = offer(),
    expired = offer(0, 1, '0.0002', 477);
  expect((await valueOffers([good, expired], c, v.taker_nick, now)).map(x => x.value)).toEqual([BigInt(v.bond_value), 0n]);
  expect(c.utxo).toHaveBeenCalledTimes(1);
  expect((await valueOffers([expired, good], chain(), v.taker_nick, now)).map(x => x.value)).toEqual([0n, BigInt(v.bond_value)]);
});
test('a copied bond with the wrong maker identity is never valued', async () => {
  const c = chain(),
    good = offer();
  const bad = { ...good, offer: { ...good.offer, counterparty: names[1] } };
  expect((await valueOffers([bad], c, v.taker_nick, now))[0].value).toBe(0n);
  expect(c.utxo).not.toHaveBeenCalled();
});
test.each([
  { value: -1 },
  { scriptPubKey: '00' },
  { confirmations: 0 },
  { confirmations: 11 },
  { height: tip + 1 },
  { blockTime: -1 },
  { txid: 'aa'.repeat(32) },
  { confirmationProof: undefined },
])('unproven or inconsistent bond data gives zero weight: %o', async patch => {
  const out = await valueOffers([offer()], chain(patch as Partial<ChainUtxo>), v.taker_nick, now);
  expect(out[0].value).toBe(0n);
  expect(out[0].problem).toBe('Bond chain verification failed');
});
test('lookup errors do not leak arbitrary error text, while missing tip aborts all valuation', async () => {
  const c = chain();
  c.utxo.mockRejectedValue(new Error('secret backend detail'));
  expect((await valueOffers([offer()], c, v.taker_nick, now))[0].problem).not.toContain('secret');
  c.height.mockRejectedValue(new Error('offline'));
  await expect(valueOffers([offer()], c, v.taker_nick, now)).rejects.toThrow('offline');
});
test('chain changes and caller mutations cannot silently alter a valuation batch', async () => {
  const c = chain(),
    a = offer();
  const pending = valueOffers([a], c, v.taker_nick, now);
  (a.offer as { cjfee: string }).cjfee = '0.1';
  expect((await pending)[0].offer.cjfee).toBe('0.0002');
  c.height.mockResolvedValueOnce(tip).mockResolvedValueOnce(tip + 1);
  await expect(valueOffers([offer()], c, v.taker_nick, now)).rejects.toThrow('tip changed');
});
test('selects cheapest per maker then per bond, only from eligible bonded offers', async () => {
  const a = offer(0, 1, '0.001'),
    cheaper = { ...offer(0, 1), offer: { ...offer(0, 1).offer, oid: 1 } };
  const chosen = await chooseMakers(
    [
      valued(a),
      valued(cheaper),
      valued(offer(1, 7, '0.0005')),
      valued(offer(2, 7, '0.0001')),
      valued(offer(3), 0n),
      valued(offer(3, 8, '0.0003')),
    ],
    30000000,
  );
  expect(chosen.offers.map(x => [x.offer.counterparty, x.offer.oid])).toEqual([
    [names[0], 1],
    [names[2], original.offer.oid],
  ]);
  expect([...chosen.fees.values()]).toEqual([6000, 3000]);
  expect(chosen.totalFee).toBe(9000);
  expect(new Set(chosen.offers.map(x => x.bond.txid)).size).toBe(2);
});
test('enforces maker minimum, ignores failed makers, and equalizes only when requested', async () => {
  const pool = [valued(offer()), valued(offer(1, 2, '0.0001'))];
  await expect(chooseMakers(pool, 30000000, { minimum: 3 })).rejects.toThrow('Not enough');
  await expect(chooseMakers(pool, 30000000, { minimum: 2, ignored: [names[1]] })).rejects.toThrow('Not enough');
  expect((await chooseMakers(pool, 30000000, { equalize: true })).totalFee).toBe(12000);
  await expect(chooseMakers(pool, 30000000, { minimum: 0 })).rejects.toThrow('Invalid');
  await expect(chooseMakers(pool, 30000000, { count: 10 })).rejects.toThrow('Invalid');
});
test('integer-weighted draws have exact boundaries and never repeat a maker', async () => {
  const pool = [valued(offer(), 9n), valued(offer(1), 1n), valued(offer(2), 1n)];
  const draw = (n: number) => async (size: number) => Buffer.alloc(size, n);
  expect((await chooseMakers(pool, 30000000, { count: 1 }, draw(8))).offers[0].offer.counterparty).toBe(names[0]);
  expect((await chooseMakers(pool, 30000000, { count: 1 }, draw(9))).offers[0].offer.counterparty).toBe(names[1]);
  expect((await chooseMakers(pool, 30000000, { count: 1 }, draw(10))).offers[0].offer.counterparty).toBe(names[2]);
  const chosen = await chooseMakers(pool, 30000000, { count: 2 }, draw(0));
  expect(new Set(chosen.offers.map(o => o.offer.counterparty)).size).toBe(2);
  await expect(chooseMakers(pool, 30000000, { count: 1 }, draw(255))).rejects.toThrow('retries');
  await expect(chooseMakers(pool, 30000000, { count: 1 }, async () => Buffer.alloc(0))).rejects.toThrow('random');
});
test('missing, spent and zero-economic-value bonds are rejected', async () => {
  const c: ChainLookup = { ...chain(), utxo: async () => null };
  expect((await valueOffers([offer()], c, v.taker_nick, now))[0].value).toBe(0n);
  const out = await valueOffers([offer()], chain(), v.taker_nick, 0xffffffff);
  expect(out[0].value).toBe(0n);
  expect(out[0].problem).toBe('Bond value is zero');
});
