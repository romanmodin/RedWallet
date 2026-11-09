import * as bitcoin from 'bitcoinjs-lib';
import ecc from 'tiny-secp256k1';
import { BtcSegwitBech32Wallet } from '../../class/wallets/btc-segwit-bech32-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { assertBitcoinPayment, selectWallet } from '../../blue_modules/BtcElectrum';
import { assertXbtUnifiedTransaction } from '../../class/xbt/broadcast-validation';
import { BlueApp } from '../../class/blue-app';
import startImport from '../../class/wallet-import';
import WalletGradient from '../../class/wallet-gradient';
import { formatWalletBalance } from '../../blue_modules/wallet-network';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
jest.mock('electrum-client', () => jest.fn());
function funded(coinbase = false, confirmations = 100) {
  const wallet = new BtcSegwitBech32Wallet();
  wallet.setSecret(seed);
  const address = wallet._getExternalAddressByIndex(0);
  const change = wallet._getInternalAddressByIndex(0);
  const raw = new bitcoin.Transaction();
  raw.addInput(Buffer.alloc(32, coinbase ? 0 : 1), coinbase ? 0xffffffff : 0);
  raw.addOutput(bitcoin.address.toOutputScript(address), 100_000n);
  jest.spyOn(wallet, 'getTransactions').mockReturnValue([{ txid: raw.getId(), rawHex: raw.toHex(), confirmations } as any]);
  const utxo = { txid: raw.getId(), vout: 0, value: 100_000, address, confirmations };
  return { wallet, utxo, change, address };
}
const recipient = 'bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g';
afterEach(() => selectWallet());
test('uses a distinct blue wallet identity for the same BIP84 seed', () => {
  const btc = funded().wallet;
  const xbt = new XbtSegwitBech32Wallet();
  xbt.setSecret(seed);
  expect(btc.getID()).not.toBe(xbt.getID());
  expect(WalletGradient.gradientsFor(btc.type)).toEqual(['#2478D4', '#143D80']);
  expect(btc.allowSend()).toBe(true);
  expect(btc.allowBIP47()).toBe(false);
  expect(btc.allowPayJoin()).toBe(false);
  expect(btc.allowRBF()).toBe(false);
});
test('signs a valid standard BTC SIGHASH_ALL transaction that the XBT broadcaster refuses', () => {
  const { wallet, utxo, change } = funded();
  const { tx, fee } = wallet.createTransaction([utxo], [{ address: recipient, value: 20_000 }], 2, change);
  expect(tx).toBeDefined();
  expect(fee).toBeGreaterThan(0);
  const [sig, pubkey] = tx!.ins[0].witness;
  const decoded = bitcoin.script.signature.decode(sig);
  expect(decoded.hashType).toBe(bitcoin.Transaction.SIGHASH_ALL);
  const script = bitcoin.payments.p2pkh({ pubkey }).output!;
  const digest = tx!.hashForWitnessV0(0, script, 100_000n, decoded.hashType);
  expect(ecc.verify(digest, pubkey, decoded.signature)).toBe(true);
  expect(() => assertBitcoinPayment(tx!.toHex())).not.toThrow();
  expect(() => assertXbtUnifiedTransaction(tx!.toHex())).toThrow();
  sig[sig.length - 1] = 0x21;
  expect(() => assertBitcoinPayment(tx!.toHex())).toThrow();
});
test.each([99, 100])('requires Bitcoin coinbase maturity at %s confirmations', confirmations => {
  const { wallet, utxo, change } = funded(true, confirmations);
  const sign = () => wallet.createTransaction([utxo], [{ address: recipient, value: 20_000 }], 2, change);
  if (confirmations < 100) expect(sign).toThrow('100 confirmations');
  else expect(sign).not.toThrow();
});
test('refuses altered input amounts, foreign change and missing parent data', () => {
  const { wallet, utxo, change } = funded();
  expect(() => wallet.createTransaction([{ ...utxo, value: 90_000 }], [{ address: recipient, value: 20_000 }], 2, change)).toThrow(
    'input does not match',
  );
  expect(() =>
    wallet.createTransaction([utxo], [{ address: recipient, value: 20_000 }], 2, 'bc1q86uhqahctvu7ygjenrcpp9c6dmxu6s8wzktfd4'),
  ).toThrow('change address');
  (wallet.getTransactions as jest.Mock).mockReturnValue([]);
  expect(() => wallet.createTransaction([utxo], [{ address: recipient, value: 20_000 }], 2, change)).toThrow(
    'input transaction is unavailable',
  );
});
test('imports BTC explicitly and offline; default imports remain XBT', async () => {
  const { promise } = startImport(
    seed,
    false,
    false,
    true,
    () => {},
    () => {},
    async () => '',
    true,
    'segwit',
    {},
    'btc',
  );
  const result = await promise;
  expect(result.wallets).toHaveLength(1);
  expect(result.wallets[0]).toBeInstanceOf(BtcSegwitBech32Wallet);
  expect(require('electrum-client')).not.toHaveBeenCalled();
});
test('does not sum BTC into XBT totals or refresh a deselected BTC wallet', async () => {
  const btc = funded().wallet;
  const xbt = new XbtSegwitBech32Wallet();
  xbt.setSecret(seed);
  jest.spyOn(btc, 'getBalance').mockReturnValue(50_000);
  jest.spyOn(xbt, 'getBalance').mockReturnValue(75_000);
  const refresh = jest.spyOn(btc, 'fetchBalance').mockResolvedValue(undefined);
  jest.spyOn(xbt, 'fetchBalance').mockResolvedValue(undefined);
  const app = new BlueApp();
  app.wallets = [btc, xbt];
  expect(app.getBalance()).toBe(75_000);
  await app.fetchWalletBalances();
  expect(refresh).not.toHaveBeenCalled();
});
test('restores BTC and XBT with separate identities and hidden flags without connecting to Bitcoin', async () => {
  const btc = new BtcSegwitBech32Wallet();
  btc.setSecret(seed);
  btc.hideBalance = true;
  const xbt = new XbtSegwitBech32Wallet();
  xbt.setSecret(seed);
  const storage = new BlueApp();
  storage.wallets = [btc, xbt];
  await storage.saveToDisk();
  const restored = new BlueApp();
  expect(await restored.loadFromDisk()).toBe(true);
  expect(restored.wallets).toHaveLength(2);
  expect(restored.wallets[0]).toBeInstanceOf(BtcSegwitBech32Wallet);
  expect(restored.wallets[0].getID()).toBe(btc.getID());
  expect(restored.wallets[0].hideBalance).toBe(true);
  expect(restored.wallets[1]).toBeInstanceOf(XbtSegwitBech32Wallet);
  expect(restored.wallets[1].getID()).toBe(xbt.getID());
  expect(require('electrum-client')).not.toHaveBeenCalled();
  expect(formatWalletBalance(btc, 100_000_000, BitcoinUnit.BTC, true)).toMatch(/ BTC$/);
  expect(formatWalletBalance(xbt, 100_000_000, BitcoinUnit.BTC, true)).toMatch(/ XBT$/);
});
test('advances cached Bitcoin coinbase confirmations through maturity instead of freezing after seven blocks', async () => {
  const { wallet, utxo, change } = funded(true, 7);
  const transaction = wallet.getTransactions()[0];
  wallet._txs_by_external_index[0] = [transaction];
  const backend = {
    ensureConnected: jest.fn().mockResolvedValue(true),
    multiGetHistoryByAddress: jest.fn().mockResolvedValue({ address: [{ tx_hash: utxo.txid, height: 1_000_000 }] }),
    estimateCurrentBlockheight: jest.fn().mockReturnValue(1_000_098),
  };
  jest.spyOn(wallet, 'getElectrum').mockReturnValue(backend as any);
  // Model a shared cache hit: the base refresh leaves a 7+ confirmation transaction alone.
  const baseRefresh = jest.spyOn(AbstractHDElectrumWallet.prototype, 'fetchTransactions').mockResolvedValue(undefined);
  try {
    await wallet.fetchTransactions();
    expect(transaction.confirmations).toBe(99);
    expect(() => wallet.createTransaction([{ ...utxo, confirmations: 99 }], [{ address: recipient, value: 20_000 }], 2, change)).toThrow(
      '100 confirmations',
    );
    backend.estimateCurrentBlockheight.mockReturnValue(1_000_099);
    await wallet.fetchTransactions();
    expect(transaction.confirmations).toBe(100);
    expect(() =>
      wallet.createTransaction([{ ...utxo, confirmations: 100 }], [{ address: recipient, value: 20_000 }], 2, change),
    ).not.toThrow();
  } finally {
    baseRefresh.mockRestore();
  }
});
