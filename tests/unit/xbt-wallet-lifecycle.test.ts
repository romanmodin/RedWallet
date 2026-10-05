/** Software lifecycle regression using recorded Knots funding; this is not a live-node or native-device test. */
import * as bitcoin from 'bitcoinjs-lib';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { BlueApp } from '../../class/blue-app';
import { discoverXbtRecovery } from '../../class/xbt/recovery-discovery';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { HDSegwitBech32Transaction } from '../../class/hd-segwit-bech32-transaction';
import { XbtTaprootTransaction } from '../../class/xbt-taproot-transaction';
import segwitFixture from '../fixtures/xbt-knots-regtest-acceptance.json';
import taprootFixture from '../fixtures/xbt-taproot-knots-regtest-acceptance.json';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  ...jest.requireActual('../../blue_modules/BlueElectrum'),
  ensureConnected: jest.fn().mockResolvedValue(true),
  waitTillConnected: jest.fn().mockResolvedValue(true),
  multiGetHistoryByAddress: jest.fn(),
  getTransactionsByAddress: jest.fn(),
  multiGetBalanceByAddress: jest.fn(),
  multiGetUtxoByAddress: jest.fn(),
  multiGetTransactionByTxid: jest.fn(),
  getReportedBlockTip: jest.fn().mockResolvedValue(200),
  estimateCurrentBlockheight: jest.fn().mockReturnValue(200),
  broadcastV2: jest.fn(),
}));
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
type RecordTx = { raw: bitcoin.Transaction; confirmations: number };

beforeEach(async () => {
  await AsyncStorage.clear();
});

test.each(['segwit', 'taproot'] as const)(
  '%s recovery → refresh → sign → RBF → CPFP → encrypted restart → delete → recover',
  async format => {
    const fixture = format === 'taproot' ? taprootFixture : segwitFixture;
    const records = new Map<string, RecordTx>();
    for (const funding of fixture.fixture.fundingTransactions) {
      const raw = bitcoin.Transaction.fromHex(funding.rawTx);
      records.set(raw.getId(), { raw, confirmations: funding.confirmations });
    }
    const allOutputs = () =>
      [...records].flatMap(([txid, record]) => record.raw.outs.map((output, vout) => ({ txid, vout, output, record })));
    const inputId = (input: bitcoin.Transaction['ins'][number]) => Buffer.from(input.hash).reverse().toString('hex');
    const addressOf = (script: Uint8Array): string | undefined => {
      try {
        return bitcoin.address.fromOutputScript(script);
      } catch {
        return undefined;
      }
    };
    const unspent = () => {
      const spent = new Set([...records.values()].flatMap(record => record.raw.ins.map(input => `${inputId(input)}:${input.index}`)));
      return allOutputs().filter(output => !spent.has(`${output.txid}:${output.vout}`));
    };
    (BlueElectrum.multiGetHistoryByAddress as jest.Mock).mockImplementation(async (addresses: string[]) =>
      Object.fromEntries(
        addresses.map(address => [
          address,
          [...records]
            .filter(
              ([, record]) =>
                record.raw.outs.some(out => addressOf(out.script) === address) ||
                record.raw.ins.some(input => {
                  const parent = records.get(inputId(input));
                  return parent && addressOf(parent.raw.outs[input.index]?.script) === address;
                }),
            )
            .map(([tx_hash, record]) => ({ tx_hash, height: record.confirmations ? 200 - record.confirmations + 1 : 0 })),
        ]),
      ),
    );
    (BlueElectrum.getTransactionsByAddress as jest.Mock).mockImplementation(
      async (address: string) => (await BlueElectrum.multiGetHistoryByAddress([address]))[address],
    );
    (BlueElectrum.multiGetBalanceByAddress as jest.Mock).mockImplementation(async (addresses: string[]) => {
      const balances = Object.fromEntries(
        addresses.map(address => {
          const outputs = unspent().filter(out => addressOf(out.output.script) === address);
          return [
            address,
            {
              confirmed: outputs.filter(out => out.record.confirmations > 0).reduce((n, out) => n + Number(out.output.value), 0),
              unconfirmed: outputs.filter(out => out.record.confirmations === 0).reduce((n, out) => n + Number(out.output.value), 0),
            },
          ];
        }),
      );
      return { addresses: balances };
    });
    (BlueElectrum.multiGetUtxoByAddress as jest.Mock).mockImplementation(async (addresses: string[]) =>
      Object.fromEntries(
        addresses.map(address => [
          address,
          unspent()
            .filter(out => addressOf(out.output.script) === address)
            .map(out => ({
              txid: out.txid,
              vout: out.vout,
              address,
              value: Number(out.output.value),
              confirmations: out.record.confirmations,
              height: out.record.confirmations ? 200 - out.record.confirmations + 1 : 0,
            })),
        ]),
      ),
    );
    (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async (ids: string[], verbose: boolean) =>
      Object.fromEntries(
        ids
          .filter(id => records.has(id))
          .map(id => {
            const record = records.get(id)!;
            const decoded = BlueElectrum.txhexToElectrumTransaction(record.raw.toHex());
            return [id, verbose ? { ...decoded, rawHex: record.raw.toHex(), confirmations: record.confirmations } : record.raw.toHex()];
          }),
      ),
    );
    (BlueElectrum.broadcastV2 as jest.Mock).mockImplementation(async (hex: string) => {
      const raw = bitcoin.Transaction.fromHex(hex);
      const inputs = new Set(raw.ins.map(input => `${inputId(input)}:${input.index}`));
      for (const [id, record] of records)
        if (!record.confirmations && record.raw.ins.some(input => inputs.has(`${inputId(input)}:${input.index}`))) records.delete(id);
      records.set(raw.getId(), { raw, confirmations: 0 });
      return raw.getId();
    });
    const discover = async () => {
      const wallets = [];
      for await (const result of discoverXbtRecovery(seed, undefined, {}, () => true)) if (result.wallet) wallets.push(result.wallet);
      expect(wallets).toHaveLength(1);
      return wallets[0];
    };
    const wallet = await discover();
    expect(wallet.type).toBe(format === 'taproot' ? XbtTaprootWallet.type : XbtSegwitBech32Wallet.type);
    const initialBalance = wallet.getBalance();
    expect(initialBalance).toBe(100000);
    await wallet.fetchUtxo();
    expect(wallet.getUtxo()).toHaveLength(2);
    const recipient = new XbtSegwitBech32Wallet();
    recipient.setSecret('legal winner thank year wave sausage worth useful legal winner thank yellow');
    const original = wallet.createTransaction(
      wallet.getUtxo(),
      [{ address: recipient._getExternalAddressByIndex(0), value: 90000 }],
      1,
      wallet._getInternalAddressByIndex(0),
    );
    expect(original.tx).toBeDefined();
    expect(await wallet.broadcastTx(original.tx!.toHex())).toBe(true);
    await wallet.fetchBalance();
    await wallet.fetchTransactions();
    await wallet.fetchUtxo();
    expect(wallet.getTransactions().some(tx => tx.txid === original.tx!.getId() && tx.confirmations === 0)).toBe(true);
    const controllerFor = (id: string) =>
      format === 'taproot'
        ? new XbtTaprootTransaction(null, id, wallet as XbtTaprootWallet)
        : new HDSegwitBech32Transaction(null, id, wallet as XbtSegwitBech32Wallet);
    const controller = controllerFor(original.tx!.getId());
    const replacement = await controller.createRBFbumpFee(3);
    expect(replacement.tx).toBeDefined();
    expect(replacement.tx!.outs[0]).toEqual(original.tx!.outs[0]);
    expect(await wallet.broadcastTx(replacement.tx!.toHex())).toBe(true);
    await wallet.fetchBalance();
    await wallet.fetchTransactions();
    await wallet.fetchUtxo();
    expect(wallet.getTransactions().some(tx => tx.txid === original.tx!.getId())).toBe(false);
    const childController = controllerFor(replacement.tx!.getId());
    const child = await childController.createCPFPbumpFee(10);
    expect(child.tx).toBeDefined();
    expect(await wallet.broadcastTx(child.tx!.toHex())).toBe(true);
    for (const record of records.values()) record.confirmations = 1;
    await wallet.fetchBalance();
    await wallet.fetchTransactions();
    await wallet.fetchUtxo();
    expect(wallet.getTransactions().some(tx => tx.txid === child.tx!.getId() && tx.confirmations === 1)).toBe(true);
    const storage = new BlueApp();
    storage.wallets.push(wallet);
    let cacheOpens = 0;
    const originalCacheOpen = storage.getRealmForTransactions.bind(storage);
    const cacheFailure = jest.spyOn(storage, 'getRealmForTransactions').mockImplementation(async () => {
      if (++cacheOpens === 2) throw new Error('Destination cache unavailable');
      return originalCacheOpen();
    });
    await expect(storage.encryptStorage('public-test-password')).rejects.toThrow('Destination cache unavailable');
    expect(await storage.storageIsEncrypted()).toBe(false);
    const preserved = new BlueApp();
    expect(await preserved.loadFromDisk()).toBe(true);
    expect(
      preserved.wallets[0]
        .getTransactions()
        .map(tx => tx.txid)
        .sort(),
    ).toEqual(
      wallet
        .getTransactions()
        .map(tx => tx.txid)
        .sort(),
    );
    cacheFailure.mockRestore();
    await storage.encryptStorage('public-test-password');
    const wrong = new BlueApp();
    expect(await wrong.loadFromDisk('wrong-password')).toBe(false);
    expect(wrong.wallets).toHaveLength(0);
    const reopened = new BlueApp();
    expect(await reopened.loadFromDisk('public-test-password')).toBe(true);
    const restored = reopened.wallets[0] as typeof wallet;
    expect(restored.getID()).toBe(wallet.getID());
    expect(restored._getExternalAddressByIndex(restored.next_free_address_index)).toBe(
      wallet._getExternalAddressByIndex(wallet.next_free_address_index),
    );
    expect(restored.getBalance()).toBe(wallet.getBalance());
    expect(
      restored
        .getTransactions()
        .map(tx => tx.txid)
        .sort(),
    ).toEqual(
      wallet
        .getTransactions()
        .map(tx => tx.txid)
        .sort(),
    );
    reopened.deleteWallet(restored);
    await reopened.saveToDisk();
    const afterDelete = new BlueApp();
    expect(await afterDelete.loadFromDisk('public-test-password')).toBe(true);
    expect(afterDelete.wallets).toHaveLength(0);
    const deletedCache = await afterDelete.getRealmForTransactions();
    expect(deletedCache.objects('WalletTransactions')).toHaveLength(0);
    deletedCache.close();
    const recovered = await discover();
    expect(recovered.getID()).toBe(wallet.getID());
    expect(recovered.getBalance()).toBe(wallet.getBalance());
    expect(recovered.next_free_change_address_index).toBeGreaterThan(0);
  },
  60000,
);
