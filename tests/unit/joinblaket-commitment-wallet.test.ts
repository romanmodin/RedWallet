import { BlueApp } from '../../class/blue-app';
import { CommitmentStore } from '../../class/joinblaket/commitments';
import { WalletCommitmentPersistence, CommitmentWallet } from '../../class/joinblaket/commitment-wallet-store';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { reservedCoins } from '../../class/xbt/kilojoin/wallet-store';
const first = 'ab'.repeat(32),
  second = 'cd'.repeat(32);
test('application reuses one commitment queue and requires durable storage before reveal', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  let complete!: () => void;
  const save = jest.spyOn(app, 'saveToDisk').mockImplementation(
    async () =>
      new Promise<void>(resolve => {
        complete = resolve;
      }),
  );
  const store = app.createJoinBlaketCommitmentStore(wallet);
  expect(app.createJoinBlaketCommitmentStore(wallet)).toBe(store);
  let revealed = false;
  const consume = store.consume(first).then(ok => {
    revealed = ok;
  });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  expect(complete).toBeDefined();
  expect(revealed).toBe(false);
  expect(() => reservedCoins(wallet)).toThrow('pending');
  complete();
  await consume;
  expect(revealed).toBe(true);
  expect(save).toHaveBeenCalledWith(true);
  expect(await store.consume(first)).toBe(false);
  save.mockRestore();
});
test('failed durable write rolls history back and does not authorize revelation', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  const save = jest.spyOn(app, 'saveToDisk').mockRejectedValue(new Error('storage unavailable'));
  const store = app.createJoinBlaketCommitmentStore(wallet);
  await expect(store.consume(first)).rejects.toThrow('storage unavailable');
  expect(wallet._joinblaketCommitments).toBeUndefined();
  expect(await store.isUsed(first)).toBe(false);
  expect(() => reservedCoins(wallet)).not.toThrow();
  save.mockRestore();
});
test('full wallet serialization preserves consumed commitments and backup merge is a union', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  const save = jest.spyOn(app, 'saveToDisk').mockResolvedValue();
  await app.createJoinBlaketCommitmentStore(wallet).consume(first);
  const restored = XbtSegwitBech32Wallet.fromJson(JSON.stringify(wallet));
  if (!(restored instanceof XbtSegwitBech32Wallet)) throw new Error('Wrong restored wallet type');
  app.wallets = [restored];
  const store = app.createJoinBlaketCommitmentStore(restored);
  expect(await store.consume(first)).toBe(false);
  await store.mergeBackup(JSON.stringify({ used: [second], external: {} }));
  expect(JSON.parse(await store.exportBackup()).used.sort()).toEqual([first, second].sort());
  save.mockRestore();
});
test('removed wallet and corrupt history cannot be treated as an empty commitment set', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  const store = app.createJoinBlaketCommitmentStore(wallet);
  wallet._joinblaketCommitments = '{broken';
  await expect(store.consume(first)).rejects.toThrow();
  expect(wallet._joinblaketCommitments).toBe('{broken');
  app.wallets = [];
  await expect(store.isUsed(first)).rejects.toThrow('removed');
  expect(() => app.createJoinBlaketCommitmentStore(wallet)).toThrow('active storage');
});
test('compare-and-swap rejects stale independent adapters instead of losing consumed history', async () => {
  const wallet: CommitmentWallet = { getID: () => 'test' };
  const a = new WalletCommitmentPersistence(
    wallet,
    async () => {},
    () => {},
  );
  const b = new WalletCommitmentPersistence(
    wallet,
    async () => {},
    () => {},
  );
  await a.load();
  await b.load();
  await a.save(JSON.stringify({ used: [first], external: {} }));
  await expect(b.save(JSON.stringify({ used: [second], external: {} }))).rejects.toThrow('history changed');
  const store = new CommitmentStore(b);
  await store.consume(second);
  expect(JSON.parse(await store.exportBackup()).used.sort()).toEqual([first, second].sort());
});

test('wallet removal during a durable save cannot authorize revelation', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  const save = jest.spyOn(app, 'saveToDisk').mockImplementation(async () => {
    app.wallets = [];
  });
  await expect(app.createJoinBlaketCommitmentStore(wallet).consume(first)).rejects.toThrow('removed');
  expect(wallet._joinblaketCommitments).toBeUndefined();
  save.mockRestore();
});
test('concurrent requests for the same proof authorize only one reveal', async () => {
  const app = new BlueApp(),
    wallet = new XbtSegwitBech32Wallet();
  app.wallets = [wallet];
  const save = jest.spyOn(app, 'saveToDisk').mockResolvedValue();
  const a = app.createJoinBlaketCommitmentStore(wallet),
    b = app.createJoinBlaketCommitmentStore(wallet);
  expect(await Promise.all([a.consume(first), b.consume(first)])).toEqual([true, false]);
  expect(save).toHaveBeenCalledTimes(1);
  save.mockRestore();
});
test('changing wallet identity invalidates its commitment adapter', async () => {
  let id = 'first';
  const wallet: CommitmentWallet = { getID: () => id };
  const store = new CommitmentStore(
    new WalletCommitmentPersistence(
      wallet,
      async () => {},
      () => {},
    ),
  );
  id = 'replacement';
  await expect(store.consume(first)).rejects.toThrow('identity changed');
});
