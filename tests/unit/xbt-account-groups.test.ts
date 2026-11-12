import {
  canGroupXbtAccounts,
  createHotXbtSibling,
  getXbtAccountMembers,
  getXbtReceiveAccount,
  groupXbtTransactions,
  linkXbtAccounts,
  setXbtReceiveAccount,
  xbtAddressType,
  xbtGroupedCards,
} from '../../blue_modules/xbt-account-groups';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { BtcWatchOnlyWallet } from '../../class/wallets/btc-watch-only-wallet';
import { Transaction } from '../../class/wallets/types';
import fixture from '../fixtures/keystone3-btc-crypto-account.json';

jest.mock('electrum-client', () => jest.fn());
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function hot() {
  const w = new XbtSegwitBech32Wallet();
  w.setSecret(seed);
  w.setLabel('My XBT');
  return w;
}
function watch(taproot = false) {
  const w = new WatchOnlyWallet();
  const account = fixture.accounts.find(a => a.path.startsWith(taproot ? 'm/86' : 'm/84'))!;
  w.setSecret(JSON.stringify({ ExtPubKey: account.xpub, MasterFingerprint: fixture.masterFingerprint, AccountKeyPath: account.path }));
  w.xbt_network = true;
  w.init();
  return w;
}
const tx = (hash: string, value: number, timestamp: number): Transaction =>
  ({ txid: hash, hash, value, timestamp, confirmations: 6 }) as Transaction;

test('creates both standard address types from the same hot seed without changing existing keys or identity', () => {
  const a = hot();
  const before = [a.getID(), a.getDerivationPath(), a._getExternalAddressByIndex(0)];
  const b = createHotXbtSibling(a);
  expect(b).toBeInstanceOf(XbtTaprootWallet);
  expect(b._getExternalAddressByIndex(0)).toBe('bc1p5cyxnuxmeuwuvkwfem96lqzszd02n6xdcjrs20cac6yqjjwudpxqkedrcr');
  expect(b.getSecret()).toBe(seed);
  expect(b.getID()).not.toBe(a.getID());
  expect([a.getID(), a.getDerivationPath(), a._getExternalAddressByIndex(0)]).toEqual(before);
  expect(createHotXbtSibling(b).getID()).toBe(a.getID());
});

test('preserves nonzero account number, passphrase, and privacy preference for hot siblings', () => {
  const a = hot();
  a.setPassphrase('public test passphrase');
  a.setDerivationPath("m/84'/0'/3'");
  a.hideBalance = true;
  const b = createHotXbtSibling(a);
  expect(b.getDerivationPath()).toBe("m/86'/0'/3'");
  expect(b.getPassphrase()).toBe(a.getPassphrase());
  expect(b.hideBalance).toBe(true);
  expect(canGroupXbtAccounts(a, b)).toBe(true);
  b.setPassphrase('');
  expect(canGroupXbtAccounts(a, b)).toBe(false);
});

test('links public Keystone accounts without changing addresses, keys, or signer enablement', () => {
  const a = watch(),
    b = watch(true);
  const before = [a.getID(), b.getID(), a.getSecret(), b.getSecret(), a._getExternalAddressByIndex(0), b._getExternalAddressByIndex(0)];
  expect(canGroupXbtAccounts(a, b)).toBe(true);
  linkXbtAccounts(a, b, 'Keystone XBT');
  expect([a.getID(), b.getID(), a.getSecret(), b.getSecret(), a._getExternalAddressByIndex(0), b._getExternalAddressByIndex(0)]).toEqual(
    before,
  );
  expect(a.allowSend()).toBe(false);
  expect(b.allowSend()).toBe(false);
  expect(() => createHotXbtSibling(a)).toThrow('Import');
  expect(getXbtAccountMembers(a, [a, b])).toEqual([a, b]);
});

test('rejects cross-chain, mixed custody, duplicate type, missing fingerprint and different account pairing', () => {
  const a = watch(),
    b = watch(true);
  const btc = new BtcWatchOnlyWallet();
  btc.setSecret(
    JSON.stringify({
      ExtPubKey: fixture.accounts[0].xpub,
      MasterFingerprint: fixture.masterFingerprint,
      AccountKeyPath: fixture.accounts[0].path,
    }),
  );
  btc.init();
  expect(canGroupXbtAccounts(a, btc)).toBe(false);
  expect(xbtAddressType(btc)).toBeUndefined();
  expect(canGroupXbtAccounts(hot(), b)).toBe(false);
  expect(canGroupXbtAccounts(a, watch())).toBe(false);
  b.masterFingerprint = 0;
  expect(canGroupXbtAccounts(a, b)).toBe(false);
  b.masterFingerprint = a.masterFingerprint;
  b._hdWalletInstance!.setDerivationPath("m/86'/0'/4'");
  expect(canGroupXbtAccounts(a, b)).toBe(false);
  expect(() => linkXbtAccounts(a, b)).toThrow();
});

test('does not hide accounts on malformed groups or partial restoration/deletion', () => {
  const a = hot(),
    b = createHotXbtSibling(a),
    extra = hot();
  extra.setPassphrase('other');
  linkXbtAccounts(a, b);
  expect(xbtGroupedCards([a, b]).wallets).toEqual([a]);
  expect(xbtGroupedCards([b]).wallets).toEqual([b]);
  expect(getXbtReceiveAccount(b, [b])).toBe(b);
  extra.xbtAccountGroup = a.xbtAccountGroup;
  expect(xbtGroupedCards([a, b, extra]).wallets).toHaveLength(3);
  b.xbtAccountGroup = undefined;
  expect(xbtGroupedCards([a, b]).wallets).toHaveLength(2);
});

test('selected receive type survives serialization while IDs and existing account state remain stable', () => {
  const a = hot(),
    b = createHotXbtSibling(a);
  linkXbtAccounts(a, b);
  setXbtReceiveAccount([a, b], b.getID());
  const restoredA = XbtSegwitBech32Wallet.fromJson(JSON.stringify(a)) as unknown as XbtSegwitBech32Wallet;
  const restoredB = XbtTaprootWallet.fromJson(JSON.stringify(b)) as unknown as XbtTaprootWallet;
  expect(getXbtReceiveAccount(restoredA, [restoredA, restoredB])).toBe(restoredB);
  expect(() => setXbtReceiveAccount([a, b], 'missing')).toThrow();
  expect(restoredA.getID()).toBe(a.getID());
});

test('combined history nets internal transfers, deduplicates repeated entries, and preserves member history', () => {
  const a = hot(),
    b = createHotXbtSibling(a);
  const left = [tx('internal', -10200, 100), tx('incoming', 30000, 90), tx('incoming', 30000, 90)];
  const right = [tx('internal', 10000, 100), tx('outgoing', -1500, 110)];
  jest.spyOn(a, 'getTransactions').mockReturnValue(left);
  jest.spyOn(b, 'getTransactions').mockReturnValue(right);
  const rows = groupXbtTransactions([a, b]);
  expect(rows.map(r => r.hash)).toEqual(['outgoing', 'internal', 'incoming']);
  expect(rows[1]).toMatchObject({ value: -200, internal: true, accounts: [a, b] });
  expect(rows[2].value).toBe(30000);
  expect(left[0].value).toBe(-10200);
  expect(right[0].value).toBe(10000);
});

test('combined cards preserve hidden balances and actual latest date', () => {
  const a = hot(),
    b = createHotXbtSibling(a);
  jest.spyOn(a, 'getBalance').mockReturnValue(123);
  jest.spyOn(b, 'getBalance').mockReturnValue(456);
  jest.spyOn(b, 'getTransactions').mockReturnValue([tx('new', 456, 1760000000)]);
  b.hideBalance = true;
  linkXbtAccounts(a, b);
  const { cards } = xbtGroupedCards([a, b]);
  expect(cards[a.getID()]).toMatchObject({ balance: 579, hideBalance: true, latestTime: 1760000000000 });
});
