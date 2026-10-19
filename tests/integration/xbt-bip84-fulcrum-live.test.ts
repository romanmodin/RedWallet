import { XbtBip84Transaction } from '../../class/xbt-bip84-transaction';
/**
 * Real backend/software lifecycle. Native UI is a separate Detox spec.
 * RN storage is mocked by the standard Jest setup; all Electrum RPCs are real.
 */
import path from 'path';
import { readFileSync } from 'fs';
import DefaultPreference from 'react-native-default-preference';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { GROUP_IO_BLUEWALLET } from '../../blue_modules/currency';
import { discoverXbtRecovery } from '../../class/xbt/recovery-discovery';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
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

live(
  'funded BIP84 discovery, authenticated RBF and confirmation through real Fulcrum',
  async () => {
    await AsyncStorage.clear();
    backend = new KnotsFulcrumHarness(backendOptions(path.join(process.cwd(), 'artifacts/native-lifecycle/software-bip84-rbf')));
    await backend.start();
    const fixture = new XbtSegwitBech32Wallet();
    fixture.setSecret(publicSeed);
    await backend.fundAddress(fixture._getExternalAddressByIndex(0), 60000);
    await backend.fundAddress(fixture._getExternalAddressByIndex(1), 40000);
    await configure(backend);
    const found = [];
    for await (const item of discoverXbtRecovery(publicSeed, undefined, {}, () => true)) if (item.wallet) found.push(item.wallet);
    expect(found).toHaveLength(1);
    const wallet = found[0] as XbtSegwitBech32Wallet;
    expect(wallet.type).toBe(XbtSegwitBech32Wallet.type);
    expect(wallet.getBalance()).toBe(100000);
    expect(wallet.allowAuthenticatedRBF()).toBe(true);
    expect(wallet.allowRBF()).toBe(false);
    const recipient = new XbtSegwitBech32Wallet();
    recipient.setSecret('legal winner thank year wave sausage worth useful legal winner thank yellow');
    await wallet.fetchUtxo();
    const original = wallet.createTransaction(
      wallet.getUtxo(),
      [{ address: recipient._getExternalAddressByIndex(0), value: 90000 }],
      1,
      wallet._getInternalAddressByIndex(0),
    ).tx!;
    expect(await wallet.broadcastTx(original.toHex())).toBe(true);
    await eventually(async () => {
      await wallet.fetchBalance();
      await wallet.fetchTransactions();
      await wallet.fetchUtxo();
      return wallet.getTransactions().some(tx => tx.txid === original.getId());
    });
    const replacement = (await new XbtBip84Transaction(original.getId(), wallet).createRBFbumpFee(25)).tx!;
    expect(replacement.outs[0]).toEqual(original.outs[0]);
    expect(replacement.outs[1].value).toBeGreaterThanOrEqual(294n);
    expect(await wallet.broadcastTx(replacement.toHex())).toBe(true);
    expect(await backend.rpc('getrawmempool')).toContain(replacement.getId());
    expect(await backend.rpc('getrawmempool')).not.toContain(original.getId());
    await backend.mine(2);
    expect((await backend.rpc('getrawtransaction', [replacement.getId(), true])).confirmations).toBe(2);
    expect(backend.receipt.forwardedMethods['blockchain.transaction.broadcast']).toBe(2);
  },
  180000,
);
