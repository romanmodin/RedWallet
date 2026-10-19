import { BlueApp } from '../../class/blue-app';
import { Journal, Round } from '../../class/xbt/kilojoin/round';
import { WalletJournalStore, reservedCoins, ReservationWallet } from '../../class/xbt/kilojoin/wallet-store';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
const input = { txid: '11'.repeat(32), vout: 0 };
const id = `${input.txid}:0`;
const pool = '0123456789abcdef';
const journal = (walletId = 'wallet'): Journal => ({ version: 1, walletId, poolId: pool, phase: 'joined', reserved: [id], deadline: 100 });
describe('CoinJoin wallet reservations', () => {
  test.each([XbtSegwitBech32Wallet, XbtTaprootWallet])(
    '%s rejects reserved inputs at transaction entry, including unsigned builds',
    async Wallet => {
      const wallet = new Wallet();
      const store = new WalletJournalStore(wallet, async () => {});
      await store.save(journal(wallet.getID()));
      expect(() => wallet.createTransaction([{ ...input, value: 50000 }], [], 1, '', undefined, true)).toThrow('reserved');
      const restored = Wallet.fromJson(JSON.stringify(wallet));
      expect(reservedCoins(restored)).toEqual(new Set([id]));
      wallet.setUTXOMetadata(input.txid, 0, { frozen: false });
      expect(reservedCoins(wallet)).toEqual(new Set([id]));
    },
  );
  test('writes are exclusive across adapter instances and sends fail closed while persistence is pending', async () => {
    const wallet: ReservationWallet = { getID: () => 'wallet' };
    let finish!: () => void;
    const store = new WalletJournalStore(
      wallet,
      () =>
        new Promise(resolve => {
          finish = resolve;
        }),
    );
    const write = store.save(journal());
    expect(() => reservedCoins(wallet)).toThrow('pending');
    await expect(new WalletJournalStore(wallet, async () => {}).save(journal())).rejects.toThrow('pending');
    finish();
    await write;
    expect(reservedCoins(wallet).has(id)).toBe(true);
  });
  test('failed release restores reservation, including when storage may have partially completed', async () => {
    const wallet: ReservationWallet = { getID: () => 'wallet' };
    const save = jest.fn(async () => {}),
      store = new WalletJournalStore(wallet, save);
    const round = await Round.join('wallet', pool, [id], 100, 1, store);
    save.mockRejectedValueOnce(new Error('disk failure'));
    await expect(round.cancel()).rejects.toThrow('disk failure');
    expect(reservedCoins(wallet).has(id)).toBe(true);
    await round.cancel();
    expect(reservedCoins(wallet).size).toBe(0);
  });
  test('conflicting rounds and corrupted journals cannot silently clear locks', async () => {
    const wallet: ReservationWallet = { getID: () => 'wallet' };
    const store = new WalletJournalStore(wallet, async () => {});
    await store.save(journal());
    await expect(store.save({ ...journal(), poolId: 'abcdef0123456789' })).rejects.toThrow('Conflicting');
    expect(reservedCoins(wallet).has(id)).toBe(true);
    wallet._kilojoinJournals![pool].reserved = [];
    expect(() => reservedCoins(wallet)).toThrow('reservation');
  });
  test('unsigned restart aborts after durable save and never preserves approval', async () => {
    const wallet: ReservationWallet = { getID: () => 'wallet' },
      store = new WalletJournalStore(wallet, async () => {});
    await store.save(journal());
    const recovered = await Round.restore(wallet._kilojoinJournals![pool], 'wallet', 200, store);
    expect(recovered.snapshot().phase).toBe('aborted');
    expect(reservedCoins(wallet).size).toBe(0);
  });
});

test('app storage propagates a persistence failure to CoinJoin and does not release locks', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  const store = app.createKilojoinJournalStore(wallet);
  const fail = jest.spyOn(app, 'getRealmForTransactions').mockRejectedValue(new Error('secure storage unavailable'));
  try {
    await expect(store.save(journal(wallet.getID()))).rejects.toThrow('secure storage unavailable');
    expect(wallet._kilojoinJournals).toBeUndefined();
  } finally {
    fail.mockRestore();
  }
});
