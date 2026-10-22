import { Round } from '../../class/xbt/kilojoin/round';
import { ReservationWallet, WalletJournalStore, reservedCoins } from '../../class/xbt/kilojoin/wallet-store';

const pool = 'ab'.repeat(16);
const coin = '11'.repeat(32) + ':0';
const first = 'aa'.repeat(32);
const second = 'bb'.repeat(32);
test('a cancelled unsigned attempt can rejoin the same pool without accepting stale writes', async () => {
  const wallet: ReservationWallet = { getID: () => 'wallet' };
  const store = new WalletJournalStore(wallet, async () => {});
  const old = await Round.join('wallet', pool, [coin], 100, 1, store, first);
  await old.cancel();
  const cancelled = old.snapshot();
  const next = await Round.join('wallet', pool, [coin], 100, 2, store, second);
  expect(next.snapshot().phase).toBe('joined');
  expect(reservedCoins(wallet)).toEqual(new Set([coin]));
  await expect(store.save(cancelled)).rejects.toThrow();
  expect(reservedCoins(wallet)).toEqual(new Set([coin]));
});

test('legacy unsigned cancellation can restart; legacy callbacks cannot clear the new attempt', async () => {
  const wallet: ReservationWallet = { getID: () => 'wallet' };
  const store = new WalletJournalStore(wallet, async () => {});
  const old = await Round.join('wallet', pool, [coin], 100, 1, store);
  await old.cancel();
  const cancelled = old.snapshot();
  await Round.join('wallet', pool, [coin], 200, 2, store, second);
  await expect(store.save(cancelled)).rejects.toThrow();
  expect(reservedCoins(wallet)).toEqual(new Set([coin]));
});
test('failed restart persistence restores the cancelled record', async () => {
  const wallet: ReservationWallet = { getID: () => 'wallet' };
  const save = jest.fn(async () => {});
  const store = new WalletJournalStore(wallet, save);
  const old = await Round.join('wallet', pool, [coin], 100, 1, store, first);
  await old.cancel();
  save.mockRejectedValueOnce(new Error('disk failure'));
  await expect(Round.join('wallet', pool, [coin], 200, 2, store, second)).rejects.toThrow('disk failure');
  expect(wallet._kilojoinJournals![pool]).toEqual(old.snapshot());
  expect(reservedCoins(wallet).size).toBe(0);
});
test('active attempts cannot be replaced and attempt IDs cannot be reused after cancellation', async () => {
  const wallet: ReservationWallet = { getID: () => 'wallet' };
  const store = new WalletJournalStore(wallet, async () => {});
  const old = await Round.join('wallet', pool, [coin], 100, 1, store, first);
  await expect(Round.join('wallet', pool, [coin], 200, 2, store, second)).rejects.toThrow();
  expect(reservedCoins(wallet)).toEqual(new Set([coin]));
  await old.cancel();
  await expect(Round.join('wallet', pool, [coin], 200, 2, store, first)).rejects.toThrow();
});

test.each(['signed', 'uncertain', 'complete'] as const)('a %s journal can never be replaced by a fresh join', async phase => {
  const { Transaction } = require('bitcoinjs-lib');
  const { utf8Hash } = require('../../class/xbt/kilojoin/crypto');
  const tx = new Transaction();
  tx.addInput(Buffer.from('11'.repeat(32), 'hex'), 0);
  tx.addOutput(Buffer.from('0014' + '22'.repeat(20), 'hex'), 100n);
  const reviewedHex = tx.toHex();
  const wallet: ReservationWallet = {
    getID: () => 'wallet',
    _kilojoinJournals: {
      [pool]: {
        version: 1,
        walletId: 'wallet',
        poolId: pool,
        attemptId: first,
        phase,
        reserved: phase === 'complete' ? [] : [coin],
        deadline: 100,
        reviewedHex,
        reviewedId: tx.getId(),
        myFee: 1,
        commitment: utf8Hash('wallet|' + pool + '|' + reviewedHex + '|1').toString('hex'),
      },
    },
  };
  const original = JSON.stringify(wallet._kilojoinJournals);
  const store = new WalletJournalStore(wallet, async () => {});
  await expect(Round.join('wallet', pool, [coin], 200, 2, store, second)).rejects.toThrow();
  expect(JSON.stringify(wallet._kilojoinJournals)).toBe(original);
});
