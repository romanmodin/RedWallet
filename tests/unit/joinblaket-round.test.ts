import { address } from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { BlueApp } from '../../class/blue-app';
import { PaymentRound, RoundJournal, validateRound } from '../../class/joinblaket/round';
import { JoinBlaketWalletStore } from '../../class/joinblaket/wallet-store';
import { buildPayment } from '../../class/joinblaket/transaction';
import { heldJoinBlaketChangeScripts, reservedCoins, ReservationWallet, WalletJournalStore } from '../../class/xbt/kilojoin/wallet-store';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const v = vectors.transaction,
  attempt = 'ab'.repeat(32),
  point = v.taker.utxos[0].txid + ':1';
const change = v.outputs[3].scriptpubkey;
const makerWitnesses = v.inputs
  .filter(i => i.owner !== 'taker')
  .map(i => ({
    index: i.index,
    maker: i.owner,
    publicKey: i.pubkey,
    signature: i.signature,
  }));
async function setup(save = async () => {}, wallet: ReservationWallet = { getID: () => 'wallet' }) {
  const store = new JoinBlaketWalletStore(wallet, save);
  const round = await PaymentRound.begin(wallet.getID(), attempt, [point], change, 1000, 1, store);
  const payment = await buildPayment(
    {
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
    },
    async n => n - 1,
  );
  return { wallet, store, round, payment };
}
test.each([XbtSegwitBech32Wallet, XbtTaprootWallet])(
  'reservations block ordinary sends and survive wallet serialization: %s',
  async Wallet => {
    const wallet = new Wallet();
    const { round } = await setup(async () => {}, wallet);
    expect(() => wallet.createTransaction([{ ...v.taker.utxos[0], value: 45000000 }], [], 1, '', undefined, true)).toThrow('reserved');
    expect(reservedCoins(Wallet.fromJson(JSON.stringify(wallet)))).toEqual(new Set([point]));
    wallet.setUTXOMetadata(v.taker.utxos[0].txid, 1, { frozen: false });
    expect(reservedCoins(wallet)).toEqual(new Set([point]));
    await round.cancel();
    expect(reservedCoins(wallet).size).toBe(0);
  },
);
test('all maker signatures and explicit unchanged approval are required before signing', async () => {
  const { round, payment } = await setup();
  await expect(round.beforeSigning('00'.repeat(32), makerWitnesses, 10)).rejects.toThrow('transition');
  const id = await round.review(payment, 10);
  await expect(round.approve('00'.repeat(32), 11)).rejects.toThrow('changed');
  await round.approve(id, 11);
  await expect(round.beforeSigning(id, makerWitnesses.slice(1), 12)).rejects.toThrow('Every maker');
  expect(round.snapshot().phase).toBe('approved');
  await round.beforeSigning(id, makerWitnesses, 12);
  expect(round.snapshot().phase).toBe('signing');
});
test('cancellation and restart after signing retain locks until exact confirmed transaction', async () => {
  const { round, payment, wallet, store } = await setup();
  const id = await round.review(payment, 10);
  await round.approve(id, 11);
  await round.beforeSigning(id, makerWitnesses, 12);
  await round.cancel();
  expect(round.snapshot().phase).toBe('uncertain');
  expect(reservedCoins(wallet)).toEqual(new Set([point]));
  const restored = await PaymentRound.restore(JSON.parse(JSON.stringify(round.snapshot())), wallet.getID(), store);
  await expect(restored.confirm(payment.txid, 0)).rejects.toThrow('Unconfirmed');
  await expect(restored.confirm('00'.repeat(32), 5)).rejects.toThrow('Unconfirmed');
  expect(reservedCoins(wallet)).toEqual(new Set([point]));
  await restored.confirm(payment.txid, 1);
  expect(reservedCoins(wallet).size).toBe(0);
});
test.each(['preparing', 'review', 'approved'])('restart abandons unsigned %s and never preserves approval', async phase => {
  const { round, payment, wallet, store } = await setup();
  if (phase !== 'preparing') {
    const id = await round.review(payment, 10);
    if (phase === 'approved') await round.approve(id, 11);
  }
  const restored = await PaymentRound.restore(round.snapshot(), wallet.getID(), store);
  expect(restored.snapshot().phase).toBe('cancelled');
  expect(reservedCoins(wallet).size).toBe(0);
});
test('durable write failure prevents signing; failed cancellation retains existing locks', async () => {
  const save = jest.fn(async () => {});
  const { round, payment, wallet } = await setup(save);
  const id = await round.review(payment, 10);
  await round.approve(id, 11);
  save.mockRejectedValueOnce(new Error('disk error'));
  await expect(round.beforeSigning(id, makerWitnesses, 12)).rejects.toThrow('disk error');
  expect(round.snapshot().phase).toBe('approved');
  expect(wallet._joinblaketJournals![attempt].phase).toBe('approved');
  save.mockRejectedValueOnce(new Error('disk error'));
  await expect(round.cancel()).rejects.toThrow('disk error');
  expect(reservedCoins(wallet)).toEqual(new Set([point]));
});
test('pending write blocks concurrent stores, sends and duplicate lifecycle actions', async () => {
  let finish!: () => void;
  const save = jest.fn(async () => {});
  const { round, payment, wallet } = await setup(save);
  const id = await round.review(payment, 10);
  await round.approve(id, 11);
  save.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const pending = round.beforeSigning(id, makerWitnesses, 12);
  expect(() => reservedCoins(wallet)).toThrow('pending');
  await expect(round.cancel()).rejects.toThrow('transition');
  await expect(new JoinBlaketWalletStore(wallet, async () => {}).save(round.snapshot())).rejects.toThrow('pending');
  await expect(
    new WalletJournalStore(wallet, async () => {}).save({
      version: 1,
      walletId: wallet.getID(),
      poolId: '12'.repeat(8),
      phase: 'joined',
      deadline: 1000,
      reserved: [point],
    }),
  ).rejects.toThrow('pending');
  finish();
  await pending;
  expect(round.snapshot().phase).toBe('signing');
});
test('Kilojoin and JoinBlaket cannot reserve the same coin in either order', async () => {
  const { wallet } = await setup();
  const kj = {
    version: 1 as const,
    walletId: 'wallet',
    poolId: '12'.repeat(8),
    phase: 'joined' as const,
    deadline: 1000,
    reserved: [point],
  };
  await expect(new WalletJournalStore(wallet, async () => {}).save(kj)).rejects.toThrow('Conflicting');
  const other: ReservationWallet = { getID: () => 'wallet' };
  await new WalletJournalStore(other, async () => {}).save(kj);
  await expect(setup(async () => {}, other)).rejects.toThrow('Conflicting');
  expect(other._joinblaketJournals).toBeUndefined();
  expect(reservedCoins(other)).toEqual(new Set([point]));
});
test('only one JoinBlaket round can be active, and stale callbacks cannot restart it', async () => {
  const { round, wallet, store } = await setup();
  await expect(PaymentRound.begin('wallet', 'cd'.repeat(32), ['11'.repeat(32) + ':0'], change, 1000, 1, store)).rejects.toThrow(
    'already active',
  );
  const stale = round.snapshot();
  await round.cancel();
  await expect(store.save(stale)).rejects.toThrow('transition');
  expect(reservedCoins(wallet).size).toBe(0);
});
test('corrupt journals and changed fees, ownership, change or inputs fail closed', async () => {
  const { round, payment, wallet } = await setup();
  await round.review(payment, 10);
  const j = round.snapshot();
  for (const bad of [
    { ...j, commitment: '00'.repeat(32) },
    { ...j, changeScript: '0014' + '00'.repeat(20) },
    { ...j, reserved: [] },
    { ...j, payment: { ...payment, totalFee: payment.totalFee - 1 } },
    { ...j, payment: { ...payment, owners: payment.owners.map(() => 'taker') } },
    { ...j, payment: { ...payment, txid: '00'.repeat(32) } },
  ])
    expect(() => validateRound(bad)).toThrow();
  wallet._joinblaketJournals = { [attempt]: { ...j, reserved: [] } as RoundJournal };
  expect(() => reservedCoins(wallet)).toThrow();
});
test('expired review cannot become approval or permission to sign', async () => {
  const { round, payment } = await setup();
  const id = await round.review(payment, 10);
  await expect(round.approve(id, 1000)).rejects.toThrow('expired');
  await round.approve(id, 999);
  await expect(round.beforeSigning(id, makerWitnesses, 1000)).rejects.toThrow('expired');
});
test('secure application storage failures propagate to JoinBlaket', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  const fail = jest.spyOn(app, 'getRealmForTransactions').mockRejectedValue(new Error('secure storage unavailable'));
  try {
    await expect(
      PaymentRound.begin(wallet.getID(), attempt, [point], change, 1000, 1, app.createJoinBlaketJournalStore(wallet)),
    ).rejects.toThrow('secure storage unavailable');
    expect(wallet._joinblaketJournals).toBeUndefined();
  } finally {
    fail.mockRestore();
  }
});

test('ordinary change allocation skips a disclosed script, including after cancellation and restore', async () => {
  const wallet = new XbtSegwitBech32Wallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const first = wallet._getInternalAddressByIndex(0);
  const second = wallet._getInternalAddressByIndex(1);
  const script = Buffer.from(address.toOutputScript(first)).toString('hex');
  const round = await PaymentRound.begin(
    wallet.getID(),
    attempt,
    [point],
    script,
    1000,
    1,
    new JoinBlaketWalletStore(wallet, async () => {}),
  );
  expect(() => wallet.createTransaction([], [], 1, first, undefined, true)).toThrow('Change address reserved');
  await round.cancel();
  const restored = XbtSegwitBech32Wallet.fromJson(JSON.stringify(wallet));
  const read = jest.spyOn(BlueElectrum, 'getTransactionsByAddress').mockResolvedValue([]);
  try {
    expect(await restored.getChangeAddressAsync()).toBe(second);
    expect(heldJoinBlaketChangeScripts(restored)).toEqual(new Set([script]));
    expect(read).toHaveBeenCalledTimes(2);
  } finally {
    read.mockRestore();
  }
});
test('a second CoinJoin protocol cannot start with different coins while change allocation is active', async () => {
  const wallet: ReservationWallet = { getID: () => 'wallet' };
  await new WalletJournalStore(wallet, async () => {}).save({
    version: 1,
    walletId: 'wallet',
    poolId: '12'.repeat(8),
    phase: 'joined',
    deadline: 1000,
    reserved: ['33'.repeat(32) + ':0'],
  });
  await expect(setup(async () => {}, wallet)).rejects.toThrow('Conflicting CoinJoin');
  expect(wallet._joinblaketJournals).toBeUndefined();
});

test('more than 100 completed attempts compact safely without reusing change scripts or attempt IDs', async () => {
  const wallet: ReservationWallet = { getID: () => 'wallet' };
  const store = new JoinBlaketWalletStore(wallet, async () => {});
  let first!: RoundJournal;
  for (let i = 1; i <= 105; i++) {
    const id = i.toString(16).padStart(64, '0');
    const script = '0014' + i.toString(16).padStart(40, '0');
    const round = await PaymentRound.begin('wallet', id, [point], script, 1000, 1, store);
    if (i === 1) first = round.snapshot();
    await round.cancel();
  }
  expect(Object.keys(wallet._joinblaketJournals!)).toHaveLength(1);
  expect(Object.keys(wallet._joinblaketRetiredAttempts!)).toHaveLength(104);
  expect(heldJoinBlaketChangeScripts(wallet).size).toBe(105);
  expect(reservedCoins(wallet).size).toBe(0);
  await expect(store.save(first)).rejects.toThrow('Retired');
  await expect(PaymentRound.begin('wallet', 'ff'.repeat(32), [point], first.changeScript, 1000, 1, store)).rejects.toThrow(
    'already disclosed',
  );
  const restored: ReservationWallet = { ...JSON.parse(JSON.stringify(wallet)), getID: () => 'wallet' };
  expect(heldJoinBlaketChangeScripts(restored)).toEqual(heldJoinBlaketChangeScripts(wallet));
});
test('failed archival persistence restores both full journals and retired history', async () => {
  const save = jest.fn(async () => {});
  const { wallet, round, store } = await setup(save);
  await round.cancel();
  const before = wallet._joinblaketJournals,
    retired = wallet._joinblaketRetiredAttempts;
  save.mockRejectedValueOnce(new Error('archive failed'));
  await expect(PaymentRound.begin('wallet', 'cd'.repeat(32), [point], '0014' + '44'.repeat(20), 1000, 1, store)).rejects.toThrow(
    'archive failed',
  );
  expect(wallet._joinblaketJournals).toBe(before);
  expect(wallet._joinblaketRetiredAttempts).toBe(retired);
  expect(heldJoinBlaketChangeScripts(wallet)).toEqual(new Set([change]));
  expect(reservedCoins(wallet).size).toBe(0);
});
test('corrupt retired history cannot silently permit change address reuse', async () => {
  const { wallet } = await setup();
  wallet._joinblaketRetiredAttempts = { ['cd'.repeat(32)]: 'bad script' };
  expect(() => heldJoinBlaketChangeScripts(wallet)).toThrow('retired');
});
