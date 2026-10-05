/**
 * Real backend/software lifecycle. Native UI is a separate Detox spec.
 * RN storage is mocked by the standard Jest setup; all Electrum RPCs are real.
 */
import path from 'path';
import { readFileSync } from 'fs';
import * as bitcoin from 'bitcoinjs-lib';
import DefaultPreference from 'react-native-default-preference';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { GROUP_IO_BLUEWALLET } from '../../blue_modules/currency';
import { BlueApp } from '../../class/blue-app';
import { discoverXbtRecovery } from '../../class/xbt/recovery-discovery';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { HDSegwitBech32Transaction } from '../../class/hd-segwit-bech32-transaction';
import { XbtTaprootTransaction } from '../../class/xbt-taproot-transaction';
import { KnotsFulcrumHarness, backendOptions, eventually } from '../native/knots-fulcrum-harness';

const enabled = process.env.REDWALLET_LIVE_LIFECYCLE === '1';
const live = enabled ? test : test.skip;
const publicSeed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const anchor = readFileSync(path.join(__dirname, '../fixtures/tls/ca.pem'), 'utf8');
let backend: KnotsFulcrumHarness | undefined;

async function configure(harness: KnotsFulcrumHarness): Promise<void> {
  BlueElectrum.forceDisconnect();
  await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
  await DefaultPreference.set(BlueElectrum.ELECTRUM_HOST, '127.0.0.1');
  await DefaultPreference.set(BlueElectrum.ELECTRUM_SSL_PORT, String(harness.tlsPort));
  await DefaultPreference.set(BlueElectrum.ELECTRUM_TLS_CA, anchor);
  await DefaultPreference.clear(BlueElectrum.ELECTRUM_TCP_PORT);
  await BlueElectrum.setDisabled(false);
  expect(await BlueElectrum.ensureConnected()).toBe(true);
}

afterEach(async () => {
  BlueElectrum.forceDisconnect();
  await BlueElectrum.setDisabled(true);
  await backend?.stop();
  backend = undefined;
});

live.each(['segwit', 'taproot'] as const)(
  '%s recovery → real Fulcrum receive/send/RBF/CPFP/confirmation → encrypted restart → delete/recover',
  async format => {
    await AsyncStorage.clear();
    backend = new KnotsFulcrumHarness(backendOptions(path.join(process.cwd(), 'artifacts/native-lifecycle/software-' + format)));
    await backend.start();
    const fixtureWallet = format === 'taproot' ? new XbtTaprootWallet() : new XbtSegwitBech32Wallet();
    fixtureWallet.setSecret(publicSeed);
    await backend.fundAddress(fixtureWallet._getExternalAddressByIndex(0), 60_000);
    await backend.fundAddress(fixtureWallet._getExternalAddressByIndex(1), 40_000);
    await configure(backend);
    const discover = async () => {
      const found = [];
      for await (const item of discoverXbtRecovery(publicSeed, undefined, {}, () => true)) if (item.wallet) found.push(item.wallet);
      expect(found).toHaveLength(1);
      return found[0];
    };
    const wallet = await discover();
    expect(wallet.type).toBe(fixtureWallet.type);
    expect(wallet.getBalance()).toBe(100_000);
    expect(wallet.next_free_address_index).toBe(2);
    await backend.fundAddress(wallet._getExternalAddressByIndex(2), 50_000);
    await wallet.fetchBalance();
    await wallet.fetchTransactions();
    await wallet.fetchUtxo();
    expect(wallet.getBalance()).toBe(150_000);
    const recipient = new XbtSegwitBech32Wallet();
    recipient.setSecret('legal winner thank year wave sausage worth useful legal winner thank yellow');
    const original = wallet.createTransaction(
      wallet.getUtxo(),
      [{ address: recipient._getExternalAddressByIndex(0), value: 90_000 }],
      1,
      wallet._getInternalAddressByIndex(0),
    ).tx!;
    expect(original.ins.every(input => input.witness[0][input.witness[0].length - 1] === 0x21)).toBe(true);
    expect(await wallet.broadcastTx(original.toHex())).toBe(true);
    expect((await backend.rpc('getmempoolentry', [original.getId()])).vsize).toBe(original.virtualSize());
    await eventually(async () => {
      await wallet.fetchBalance();
      await wallet.fetchTransactions();
      await wallet.fetchUtxo();
      return wallet.getTransactions().some(tx => tx.txid === original.getId());
    });
    const controller = (txid: string) =>
      format === 'taproot'
        ? new XbtTaprootTransaction(null, txid, wallet as XbtTaprootWallet)
        : new HDSegwitBech32Transaction(null, txid, wallet as XbtSegwitBech32Wallet);
    const replacement = (await controller(original.getId()).createRBFbumpFee(4)).tx!;
    expect(replacement.outs[0]).toEqual(original.outs[0]);
    expect(await wallet.broadcastTx(replacement.toHex())).toBe(true);
    const mempool = await backend.rpc('getrawmempool');
    expect(mempool).toContain(replacement.getId());
    expect(mempool).not.toContain(original.getId());
    await eventually(async () => {
      await wallet.fetchBalance();
      await wallet.fetchTransactions();
      await wallet.fetchUtxo();
      return wallet.getTransactions().some(tx => tx.txid === replacement.getId());
    });
    const child = (await controller(replacement.getId()).createCPFPbumpFee(10)).tx!;
    expect(await wallet.broadcastTx(child.toHex())).toBe(true);
    expect(await backend.rpc('getrawmempool')).toContain(child.getId());
    const mutated = bitcoin.Transaction.fromHex(child.toHex());
    const signature = mutated.ins[0].witness[0];
    signature[signature.length - 1] = 0x01;
    expect((await backend.rpc('testmempoolaccept', [[mutated.toHex()]]))[0].allowed).toBe(false);
    await backend.mine(2);
    for (const tx of [replacement, child]) expect((await backend.rpc('getrawtransaction', [tx.getId(), true])).confirmations).toBe(2);
    await eventually(async () => {
      await wallet.fetchBalance();
      await wallet.fetchTransactions();
      await wallet.fetchUtxo();
      return wallet.getTransactions().some(tx => tx.txid === child.getId() && tx.confirmations === 2);
    });
    const before = wallet
      .getTransactions()
      .map(tx => tx.txid)
      .sort();
    const storage = new BlueApp();
    storage.wallets.push(wallet);
    await storage.saveToDisk();
    await storage.encryptStorage('public-fixture-password');
    const wrong = new BlueApp();
    expect(await wrong.loadFromDisk('wrong-password')).toBe(false);
    const restarted = new BlueApp();
    expect(await restarted.loadFromDisk('public-fixture-password')).toBe(true);
    expect(
      restarted.wallets[0]
        .getTransactions()
        .map(tx => tx.txid)
        .sort(),
    ).toEqual(before);
    restarted.deleteWallet(restarted.wallets[0]);
    await restarted.saveToDisk();
    const empty = new BlueApp();
    expect(await empty.loadFromDisk('public-fixture-password')).toBe(true);
    expect(empty.wallets).toHaveLength(0);
    const recovered = await discover();
    expect(
      recovered
        .getTransactions()
        .map(tx => tx.txid)
        .sort(),
    ).toEqual(before);
    expect(recovered.next_free_change_address_index).toBeGreaterThan(0);
    expect(backend.receipt.forwardedMethods['blockchain.transaction.broadcast']).toBe(3);
    console.info('Real backend software lifecycle passed:', format, 'height', await backend.rpc('getblockcount'));
  },
  180_000,
);

live(
  'rejects expired TLS/wrong checkpoints; bounded timeout/cancellation and disconnect/reconnect preserve discovery semantics',
  async () => {
    backend = new KnotsFulcrumHarness(backendOptions(path.join(process.cwd(), 'artifacts/native-lifecycle/server-faults')));
    await backend.start();
    backend.setCertificate('native-expired.pem');
    expect(await BlueElectrum.testConnection('127.0.0.1', undefined, backend.tlsPort, anchor)).toBe(false);
    expect(backend.receipt.checkpointRequests).toBe(0);
    backend.setCertificate('native.pem');
    backend.fault = 'wrong-checkpoint';
    expect(await BlueElectrum.testConnection('127.0.0.1', undefined, backend.tlsPort, anchor)).toBe(false);
    backend.fault = 'none';
    await configure(backend);
    const cancelled = discoverXbtRecovery(publicSeed, undefined, {}, () => false);
    await expect(cancelled.next()).rejects.toThrow('Discovery stopped');
    backend.fault = 'history-timeout';
    const started = Date.now();
    await expect(discoverXbtRecovery(publicSeed, undefined, {}, () => true).next()).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(35_000);
    backend.fault = 'none';
    backend.disconnectClients();
    BlueElectrum.forceDisconnect();
    await configure(backend);
    // Start from an authenticated live socket, so this assertion observes the
    // injected reset rather than the previous timeout's disconnected client.
    backend.fault = 'disconnect';
    const disconnectedAt = Date.now();
    await expect(BlueElectrum.multiGetHistoryByAddress(['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'])).rejects.toThrow();
    expect(Date.now() - disconnectedAt).toBeLessThan(35_000);
    expect(backend.receipt.disconnectFaults).toBeGreaterThan(0);
    backend.fault = 'none';
    backend.disconnectClients();
    BlueElectrum.forceDisconnect();
    await configure(backend);
    expect(await BlueElectrum.multiGetHistoryByAddress(['bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu'])).toEqual({
      bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu: [],
    });
  },
  120_000,
);
