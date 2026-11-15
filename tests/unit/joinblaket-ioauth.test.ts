import { ChainUtxo } from '../../class/joinblaket/chain';
import { checkIoauth } from '../../class/joinblaket/ioauth';
import { Box } from '../../class/joinblaket/nacl';
import { MakerOffer } from '../../class/joinblaket/offers';
import { decodeIoauth, IoAuth } from '../../class/joinblaket/session-messages';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';
const v = vectors.session,
  e = vectors.encryption,
  tip = 962000;
const offer: MakerOffer = {
  counterparty: v.maker_nick,
  oid: 0,
  type: 'sw0reloffer',
  minsize: 27300,
  maxsize: 2500000000,
  txfee: 0,
  cjfee: '0.0002',
};
function fixture() {
  const b = new Box(Buffer.from(e.taker_private, 'hex'), Buffer.from(e.maker_public, 'hex'));
  try {
    return decodeIoauth(b, v.ioauth.ciphertext);
  } finally {
    b.destroy();
  }
}
function chain(patch: Partial<ChainUtxo> = {}) {
  return {
    height: jest.fn(async () => tip),
    utxo: jest.fn(async (txid: string, vout: number): Promise<ChainUtxo | null> => {
      const input = vectors.transaction.inputs.find(x => x.txid === txid && x.vout === vout)!;
      return {
        txid,
        vout,
        value: input.value,
        scriptPubKey: input.scriptpubkey,
        height: 961600,
        confirmations: tip - 961600 + 1,
        blockTime: 1760000000,
        blockHash: '00'.repeat(32),
        confirmationProof: 'anchored-merkle-pow',
        unspentSource: 'electrum',
        ...patch,
      };
    }),
  };
}
function request(io: IoAuth = fixture()) {
  return { io, offer: { ...offer }, makerPublicKey: e.maker_public, amount: 30000000, taken: new Set<string>() };
}
test('pinned maker authorization produces only chain-sourced input amounts and approved offer fees', async () => {
  const result = await checkIoauth(request(), chain());
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  expect(result.part.makerFee).toBe(6000);
  expect(result.part.coins.map(x => x.value)).toEqual(vectors.transaction.inputs.slice(1, 3).map(x => x.value));
  expect(result.authPub).toBe(v.ioauth.auth_pub);
  expect(Object.isFrozen(result.part.coins)).toBe(true);
});
test('wrong maker encryption key, invalid offer and duplicate/overlapping inputs fail before lookup', async () => {
  const io = fixture();
  for (const r of [
    { ...request(), makerPublicKey: 'ab'.repeat(32) },
    { ...request(), offer: { ...offer, cjfee: '0.1' } },
    request({ ...io, utxos: [] }),
    request({ ...io, utxos: [io.utxos[0], io.utxos[0]] }),
    { ...request(), taken: new Set([io.utxos[0].txid + ':' + io.utxos[0].vout]) },
  ]) {
    const c = chain();
    expect((await checkIoauth(r, c)).ok).toBe(false);
    expect(c.utxo).not.toHaveBeenCalled();
  }
});
test.each([
  { value: -1 },
  { value: 0 },
  { confirmations: 0 },
  { confirmations: 1 },
  { height: tip + 1 },
  { txid: 'aa'.repeat(32) },
  { vout: 12 },
  { scriptPubKey: '0014' + '00'.repeat(20) },
  { confirmationProof: undefined },
])('rejects unproven or altered chain input: %o', async patch => {
  expect((await checkIoauth(request(), chain(patch as Partial<ChainUtxo>))).ok).toBe(false);
});
test('backend failures are distinguished from spent outputs without leaking error contents', async () => {
  const c = chain();
  c.utxo.mockRejectedValue(new Error('private backend text'));
  expect(await checkIoauth(request(), c)).toEqual({ ok: false, unavailable: true, reason: 'Chain verification unavailable' });
  c.utxo.mockResolvedValue(null);
  expect(await checkIoauth(request(), c)).toEqual({ ok: false, unavailable: false, reason: 'Maker output is spent or missing' });
});
test('requires maker change minimum, a controlled input and supported distinct output scripts', async () => {
  const io = fixture();
  expect((await checkIoauth(request(), chain({ value: 15000000 }))).ok).toBe(false);
  expect((await checkIoauth(request({ ...io, paymentAddress: io.changeAddress }), chain())).ok).toBe(false);
  expect((await checkIoauth(request({ ...io, changeAddress: 'bcrt1invalid' }), chain())).ok).toBe(false);
  const noMetadata = { ...io, utxos: io.utxos.map(x => ({ txid: x.txid, vout: x.vout })) };
  expect((await checkIoauth(request(noMetadata), chain({ scriptPubKey: '0014' + '00'.repeat(20) }))).ok).toBe(false);
});
test('snapshots maker data before async lookups and rejects a changed chain view', async () => {
  const r = request(),
    pending = checkIoauth(r, chain());
  r.offer.txfee = 50000000;
  r.offer.cjfee = '0.1';
  const result = await pending;
  expect(result.ok).toBe(true);
  if (result.ok) expect(result.part.miningContribution).toBe(0);
  const c = chain();
  c.height.mockResolvedValueOnce(tip).mockResolvedValueOnce(tip + 1);
  expect(await checkIoauth(request(), c)).toEqual({ ok: false, unavailable: true, reason: 'Chain view changed' });
});
