import { Transaction, script } from 'bitcoinjs-lib';
import { makerInputDigest, verifyMakerWitness, verifyAllMakerWitnesses, SpentCoin } from '../../class/joinblaket/signatures';
import { estimateMarket, parseMarket } from '../../class/joinblaket/market';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const v = vectors.transaction;
const coins: SpentCoin[] = v.inputs.map(x => ({ txid: x.txid, vout: x.vout, value: x.value, scriptPubKey: x.scriptpubkey }));
const witnesses = v.inputs
  .filter(x => x.owner !== 'taker')
  .map(x => ({ index: x.index, maker: x.owner, publicKey: x.pubkey, signature: x.signature }));
describe('JoinBlaket maker signatures match upstream vectors', () => {
  test.each(v.inputs)('input $index digest and witness match exactly', input => {
    expect(makerInputDigest(v.unsigned_tx, coins, input.index, input.pubkey).toString('hex')).toBe(input.unified_sighash);
    expect(
      verifyMakerWitness(v.unsigned_tx, coins, {
        index: input.index,
        maker: input.owner,
        publicKey: input.pubkey,
        signature: input.signature,
      }),
    ).toBe(true);
  });
  test('all maker inputs must be verified, exactly once, with correct ownership', () => {
    expect(() => verifyAllMakerWitnesses(v.unsigned_tx, coins, v.metadata.input_owners, witnesses)).not.toThrow();
    expect(() => verifyAllMakerWitnesses(v.unsigned_tx, coins, v.metadata.input_owners, witnesses.slice(1))).toThrow();
    expect(() =>
      verifyAllMakerWitnesses(v.unsigned_tx, coins, v.metadata.input_owners, [witnesses[0], witnesses[0], witnesses[2]]),
    ).toThrow();
    expect(() =>
      verifyAllMakerWitnesses(
        v.unsigned_tx,
        coins,
        v.metadata.input_owners,
        witnesses.map((w, i) => (i === 0 ? { ...w, maker: 'taker' } : w)),
      ),
    ).toThrow();
    expect(() =>
      verifyAllMakerWitnesses(
        v.unsigned_tx,
        coins,
        coins.map(() => 'taker'),
        [],
      ),
    ).toThrow();
  });
  test.each([0x01, 0x02, 0x03, 0x81, 0xa1])('rejects replayable or altered sighash type %i', hashType => {
    const signature = Buffer.from(witnesses[0].signature, 'hex');
    signature[signature.length - 1] = hashType;
    expect(verifyMakerWitness(v.unsigned_tx, coins, { ...witnesses[0], signature: signature.toString('hex') })).toBe(false);
  });
  test('rejects high-S, invalid DER, altered signatures and nonowner keys', () => {
    const encoded = Buffer.from(witnesses[0].signature, 'hex');
    encoded[encoded.length - 1] = 1;
    const compact = Buffer.from(script.signature.decode(encoded).signature);
    const n = BigInt('0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141');
    const highS = n - BigInt('0x' + compact.subarray(32).toString('hex'));
    Buffer.from(highS.toString(16).padStart(64, '0'), 'hex').copy(compact, 32);
    const malleable = Buffer.from(script.signature.encode(compact, 1));
    malleable[malleable.length - 1] = 0x21;
    expect(verifyMakerWitness(v.unsigned_tx, coins, { ...witnesses[0], signature: malleable.toString('hex') })).toBe(false);
    for (const signature of ['0021', witnesses[0].signature + '00', witnesses[0].signature.replace('3044', '3144')]) {
      expect(verifyMakerWitness(v.unsigned_tx, coins, { ...witnesses[0], signature })).toBe(false);
    }
    expect(verifyMakerWitness(v.unsigned_tx, coins, { ...witnesses[0], publicKey: v.inputs[0].pubkey })).toBe(false);
  });
  test('commits every prevout amount, outpoint and transaction output', () => {
    const changed = coins.map((c, i) => (i === 0 ? { ...c, value: c.value + 1 } : c));
    expect(verifyMakerWitness(v.unsigned_tx, changed, witnesses[0])).toBe(false);
    expect(
      verifyMakerWitness(
        v.unsigned_tx,
        coins.map((c, i) => (i ? c : { ...c, txid: '00'.repeat(32) })),
        witnesses[0],
      ),
    ).toBe(false);
    const tx = Transaction.fromHex(v.unsigned_tx);
    tx.outs[0].value += 1n;
    expect(verifyMakerWitness(tx.toHex(), coins, witnesses[0])).toBe(false);
    expect(verifyMakerWitness(v.signed_tx, coins, witnesses[0])).toBe(false);
    const badFee = Transaction.fromHex(v.unsigned_tx);
    badFee.outs[0].value = 1n;
    expect(verifyMakerWitness(badFee.toHex(), coins, witnesses[0])).toBe(false);
  });
});
const sample = {
  updated: 'x',
  height: 981795,
  network: 'xbt',
  makers: 2,
  min_amount: 100000,
  max_amount: 12312375,
  offers: [
    { type: 'rel', minsize: 100000, maxsize: 12312375, cjfee: '0.00002', txfee: 0, bond_value: 27738 },
    { type: 'abs', minsize: 500000, maxsize: 2000000, cjfee: '300', txfee: 50, bond_value: 100 },
  ],
};
describe('read-only market estimates', () => {
  test('matches upstream display estimates without representing them as verified', () => {
    const market = parseMarket(JSON.stringify(sample));
    expect(estimateMarket(market, 200000, '2')).toEqual({ makers: 1, makerFees: 4, miningFee: 542, total: 546, verified: false });
    expect(estimateMarket(market, 1000000, '1')).toEqual({ makers: 2, makerFees: 320, miningFee: 351, total: 671, verified: false });
    expect(estimateMarket(market, 50000, '1')).toBeNull();
    expect(estimateMarket(market, 20000000, '1')).toBeNull();
  });
  test('strictly checks network, monetary input, shape and response bounds', () => {
    for (const malformed of [
      { ...sample, network: 'btc' },
      { ...sample, height: -1 },
      { ...sample, offers: null },
      { ...sample, offers: [{ ...sample.offers[0], type: 'evil' }] },
      { ...sample, offers: [{ ...sample.offers[0], cjfee: 'NaN' }] },
      { ...sample, offers: [{ ...sample.offers[0], minsize: 0.1 }] },
      { ...sample, offers: [{ ...sample.offers[1], cjfee: '1.5' }] },
      { ...sample, offers: [{ ...sample.offers[0], maxsize: 1 }] },
    ])
      expect(() => parseMarket(JSON.stringify(malformed))).toThrow();
    expect(() => parseMarket(' '.repeat(262145))).toThrow();
    for (const count of [-1, 0, 0.5, 129, NaN])
      expect(() => estimateMarket(parseMarket(JSON.stringify(sample)), 1000000, '2', count)).toThrow();
  });
  test('excludes zero-value bonds, caps counted offers at nine, preserves zero-maker result', () => {
    const zero = parseMarket(JSON.stringify({ ...sample, makers: 0, min_amount: null, max_amount: null, offers: [] }));
    expect(estimateMarket(zero, 200000, '1')).toBeNull();
    const many = parseMarket(JSON.stringify({ ...sample, offers: Array(12).fill(sample.offers[0]) }));
    expect(estimateMarket(many, 200000, '1')?.makers).toBe(9);
    const invalid = parseMarket(JSON.stringify({ ...sample, offers: [{ ...sample.offers[0], bond_value: 0 }] }));
    expect(estimateMarket(invalid, 200000, '1')).toBeNull();
  });
});
