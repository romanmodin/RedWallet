import { Transaction } from 'bitcoinjs-lib';
import { antiFeeSnipingLocktime, assemblePayment, buildPayment, BuildRequest } from '../../class/joinblaket/transaction';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const v = vectors.transaction;
const unchanged = async (maximum: number) => maximum - 1;
const request = (): BuildRequest => ({
  coins: v.taker.utxos.map(c => ({ ...c, scriptPubKey: c.scriptpubkey })),
  recipient: v.taker.cj_address,
  changeAddress: v.taker.change_address,
  makers: Object.entries(v.makers).map(([nick, m]) => ({
    nick,
    coins: m.utxos.map(c => ({ ...c, scriptPubKey: c.scriptpubkey })),
    paymentAddress: m.cj_addr,
    changeAddress: m.change_addr,
    makerFee: m.cjfee,
    miningContribution: m.txfee,
  })),
  amount: v.cj_amount,
  takerMiningFee: v.tx_fee,
  maxTotalFee: 7034,
  locktime: v.locktime,
});
const witnesses = v.inputs.map(i => ({
  index: i.index,
  maker: i.owner,
  signature: i.signature,
  publicKey: i.pubkey,
}));
test('build and assembly match upstream bytes, ownership and txid exactly', async () => {
  const built = await buildPayment(request(), unchanged);
  expect(built.hex).toBe(v.unsigned_tx);
  expect(built.txid).toBe(v.txid);
  expect(built.owners).toEqual(v.metadata.input_owners);
  expect(built.outputOwners.map(o => [o.owner, o.kind])).toEqual(v.metadata.output_owners);
  expect(built.totalFee).toBe(7034);
  expect(built.minerFee).toBe(684);
  expect(assemblePayment(built, witnesses)).toBe(v.signed_tx);
});
test('shuffle keeps ownership paired with inputs and outputs', async () => {
  const built = await buildPayment(request(), async () => 0);
  expect(built.hex).not.toBe(v.unsigned_tx);
  const tx = Transaction.fromHex(built.hex);
  built.coins.forEach((c, i) => {
    expect(Buffer.from(tx.ins[i].hash).reverse().toString('hex')).toBe(c.txid);
    expect(v.inputs.find(x => x.txid === c.txid)?.owner).toBe(built.owners[i]);
  });
  expect(tx.outs.map(o => o.value).sort()).toEqual(v.outputs.map(o => BigInt(o.value)).sort());
});
test('locktime matches upstream and rejects broken randomness', async () => {
  expect(await antiFeeSnipingLocktime(961700, async () => 3)).toBe(961700);
  const draws = [0, 37];
  expect(await antiFeeSnipingLocktime(961700, async () => draws.shift()!)).toBe(961663);
  expect(
    await antiFeeSnipingLocktime(0, async () => {
      throw new Error('not called');
    }),
  ).toBe(0);
  expect(await antiFeeSnipingLocktime(5, async max => (max === 10 ? 0 : 99))).toBe(1);
  await expect(antiFeeSnipingLocktime(-1)).rejects.toThrow();
  await expect(antiFeeSnipingLocktime(10, async () => 10)).rejects.toThrow('random');
  await expect(buildPayment(request(), async () => -1)).rejects.toThrow('random');
});
test('rejects duplicate inputs, makers, scripts and unsupported output types', async () => {
  const r = request();
  await expect(buildPayment({ ...r, coins: [...r.coins, r.coins[0]] }, unchanged)).rejects.toThrow('Duplicate');
  await expect(buildPayment({ ...r, makers: [r.makers[0], r.makers[0]] }, unchanged)).rejects.toThrow('duplicate');
  await expect(buildPayment({ ...r, changeAddress: r.recipient }, unchanged)).rejects.toThrow('Duplicate');
  await expect(buildPayment({ ...r, recipient: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT' }, unchanged)).rejects.toThrow('P2WPKH');
  await expect(buildPayment({ ...r, changeAddress: '' }, unchanged)).rejects.toThrow();
});
test('checks exact fee ceiling, insufficient funds and maker dust', async () => {
  const r = request();
  await expect(buildPayment({ ...r, maxTotalFee: 7033 }, unchanged)).rejects.toThrow('ceiling');
  await expect(buildPayment({ ...r, amount: 50000000 }, unchanged)).rejects.toThrow();
  const makers = [...r.makers];
  makers[1] = {
    ...makers[1],
    coins: [{ ...makers[1].coins[0], value: r.amount }],
  };
  await expect(buildPayment({ ...r, makers }, unchanged)).rejects.toThrow('minimum');
  await expect(buildPayment({ ...r, takerMiningFee: 1, maxTotalFee: 999999 }, unchanged)).rejects.toThrow('Miner fee');
});
test('dust change is included in the confirmed total cost', async () => {
  const r = request();
  const exact = r.amount + 6500 + r.takerMiningFee;
  const withDust = {
    ...r,
    coins: [{ ...r.coins[0], value: exact + 2730 }],
    maxTotalFee: 9764,
  };
  const built = await buildPayment(withDust, unchanged);
  expect(built.totalFee).toBe(9764);
  expect(built.outputOwners.some(o => o.owner === 'taker' && o.kind === 'change')).toBe(false);
  await expect(buildPayment({ ...withDust, maxTotalFee: 9763 }, unchanged)).rejects.toThrow('ceiling');
});
test('assembly rejects incomplete, duplicated, wrong-owner and replayable witnesses', async () => {
  const built = await buildPayment(request(), unchanged);
  expect(() => assemblePayment(built, witnesses.slice(1))).toThrow();
  expect(() => assemblePayment(built, [witnesses[0], witnesses[0], ...witnesses.slice(2)])).toThrow();
  expect(() =>
    assemblePayment(
      built,
      witnesses.map((w, i) => (i === 0 ? { ...w, maker: 'other' } : w)),
    ),
  ).toThrow();
  expect(() =>
    assemblePayment(
      built,
      witnesses.map((w, i) => (i === 0 ? { ...w, signature: w.signature.slice(0, -2) + '01' } : w)),
    ),
  ).toThrow();
});
test('asynchronous randomness cannot change the already validated request', async () => {
  const r = request();
  const mutable = r.coins[0] as { value: number };
  const built = await buildPayment(r, async n => {
    mutable.value = 1;
    return n - 1;
  });
  expect(built.hex).toBe(v.unsigned_tx);
  expect(built.coins[0].value).toBe(45000000);
});
