/**
 * Continuous hosted native UI → authenticated laboratory bridge → real Fulcrum
 * → fresh Knots regtest. Public disposable fixtures only. This is not physical
 * phone testing, mainnet chain verification, or cold-device interoperability.
 */
import assert from 'assert';
import { execFileSync } from 'child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import { by, device, element, expect as nativeExpect, waitFor } from 'detox';
import {
  confirmPasswordDialog,
  dismissAlertByText,
  enterMnemonicText,
  getSwitchValue,
  goBack,
  scrollUpOnHomeScreen,
  setCustomFeeRate,
  tapAndTapAgainIfElementIsNotVisible,
  typeTextIntoAlertInput,
  waitForId,
  waitForKeyboardToClose,
  waitForLabel,
  waitForText,
  waitForWalletsList,
} from './helperz';
import vectors from '../fixtures/native-lifecycle-vectors.json';
import english from '../../loc/en.json';
import { backendOptions, eventually, KnotsFulcrumHarness } from '../native/knots-fulcrum-harness';

const native = process.env.REDWALLET_NATIVE_LIVE === '1' ? describe : describe.skip;
const publicSeed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const fixturePassword = 'public-fixture-password';
const ca = readFileSync(path.join(__dirname, '../fixtures/tls/ca.pem'), 'utf8').trim();
const connectionSaved = 'Your changes have been saved successfully. Restarting RedWallet may be required for the changes to take effect.';
const connectionFailed =
  'Cannot connect to the provided Electrum server. TLS requires a trusted certificate matching the server name. XBT servers must also match the mainnet checkpoint.';

const field = (id: string) =>
  device.getPlatform() === 'ios' && id === 'HostInput'
    ? element(
        by.type('RCTUITextField').and(
          (
            by as typeof by & {
              value(text: string): ReturnType<typeof by.id>;
            }
          ).value('E.g., 10.20.30.40'),
        ),
      )
    : element(by.id(id));

async function boundedDiagnostic(action: () => Promise<unknown>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      action(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Native diagnostic exceeded 20 seconds')), 20_000);
      }),
    ]);
  } catch (error) {
    console.warn('[native-lifecycle] diagnostic/termination failed:', error);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fieldVisible(id: string): Promise<void> {
  if (device.getPlatform() === 'ios') {
    await eventually(async () => {
      await nativeExpect(field(id)).toExist();
      return true;
    }, 30_000);
  } else {
    await waitFor(field(id)).toExist().withTimeout(30_000);
  }
  await waitFor(field(id)).toBeVisible().whileElement(by.id('ElectrumSettingsScrollView')).scroll(150, 'down', 0.95, 0.5);
}

async function configureNative(backend: KnotsFulcrumHarness): Promise<void> {
  await waitForWalletsList();
  await element(by.id('SettingsButton')).tap();
  await waitForId('SettingsRoot');
  await waitFor(element(by.id('NetworkSettings')))
    .toBeVisible()
    .whileElement(by.id('SettingsRoot'))
    .scroll(150, 'down');
  await element(by.id('NetworkSettings')).tap();
  await element(by.id('ElectrumSettings')).tap();
  await waitForId('ElectrumConnectionEnabledSwitch');
  if (await getSwitchValue('ElectrumConnectionEnabledSwitch')) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
  await fieldVisible('HostInput');
  await field('HostInput').replaceText(device.getPlatform() === 'android' ? '10.0.2.2' : '127.0.0.1');
  await fieldVisible('PortInput');
  await element(by.id('PortInput')).replaceText(String(backend.tlsPort));
  await fieldVisible('SSLPortInput');
  if (!(await getSwitchValue('SSLPortInput'))) await element(by.id('SSLPortInput')).tap();
  await fieldVisible('TlsCaInput');
  await element(by.id('TlsCaInput')).replaceText(ca);
  await element(by.id('TlsCaInput')).tapReturnKey();
  await element(by.id('ElectrumSettingsScrollView')).scrollTo('bottom', 0.95, 0.5);
  // An expired certificate signed by the configured CA must be rejected before
  // any Electrum requests. Then test the checkpoint separately on valid TLS.
  console.info('[native-lifecycle] testing expired TLS rejection');
  const beforeInvalidTls = backend.receipt.checkpointRequests;
  backend.setCertificate('native-expired.pem');
  await element(by.id('Save')).tap();
  await waitForText(connectionFailed, 60_000);
  assert.equal(await dismissAlertByText('OK', 10_000, false), true);
  assert.equal(backend.receipt.checkpointRequests, beforeInvalidTls);
  console.info('[native-lifecycle] testing wrong checkpoint rejection');
  backend.setCertificate('native.pem');
  backend.fault = 'wrong-checkpoint';
  await element(by.id('Save')).tap();
  await waitForText(connectionFailed, 60_000);
  assert.equal(await dismissAlertByText('OK', 10_000, false), true);
  backend.fault = 'none';
  await element(by.id('Save')).tap();
  await waitForText(connectionSaved, 60_000);
  assert.equal(await dismissAlertByText('OK', 10_000, false), true);
  await goBack();
  await goBack();
  await goBack();
  await waitForWalletsList();
}

async function beginRecovery(): Promise<void> {
  await scrollUpOnHomeScreen();
  await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ImportWallet');
  await element(by.id('ImportWallet')).tap();
  await waitForId('MnemonicInput');
  await element(by.id('ToggleRecoveryDiscovery')).tap();
  await enterMnemonicText(publicSeed);
  await element(by.id('DoImport')).tap();
  await waitForId('RecoveryResults', 60_000);
}

async function recover(): Promise<void> {
  await beginRecovery();
  await waitFor(element(by.id('RecoveryStopButton')))
    .not.toExist()
    .withTimeout(90_000);
  await waitForId('RecoveryImportSelected');
  await element(by.id('RecoveryImportSelected')).tap();
  await waitForText('Your wallet has been successfully imported.', 60_000);
  assert.equal(await dismissAlertByText('OK', 10_000, false), true);
  await waitForWalletsList();
}

async function openWallet(label: string): Promise<void> {
  await scrollUpOnHomeScreen();
  await tapAndTapAgainIfElementIsNotVisible(label, 'SendButton');
  await waitForId('WalletTransactionsList');
}

async function refresh(): Promise<void> {
  await element(by.id('WalletTransactionsList')).swipe('down', 'slow', 0.75, 0.5, 0.3);
}

async function nativeText(id: string): Promise<string> {
  const attributes = (await element(by.id(id)).getAttributes()) as unknown as Record<string, unknown>;
  // Android exposes text; iOS inputs expose value and text labels expose label.
  for (const name of ['text', 'value', 'label']) {
    if (typeof attributes[name] === 'string') return attributes[name] as string;
  }
  throw new Error('Native text unavailable for ' + id);
}

async function balanceSats(): Promise<number> {
  const text = await nativeText('WalletBalance');
  const value = Number(String(text).replace(/,/g, ''));
  assert.ok(Number.isFinite(value), 'Invalid native wallet balance');
  return Math.round(value * 100_000_000);
}

async function openSentTransaction(txid: string): Promise<void> {
  await waitFor(element(by.label(/^Sent,/)).atIndex(0))
    .toExist()
    .withTimeout(30_000);
  await element(by.label(/^Sent,/))
    .atIndex(0)
    .tap();
  await waitForLabel(txid, 30_000);
}

async function bump(kind: 'rbf' | 'cpfp', rate: number): Promise<bitcoin.Transaction> {
  const id = kind === 'rbf' ? 'TransactionRbfBumpButton' : 'TransactionCpfpButton';
  await waitFor(element(by.id(id)))
    .toBeVisible()
    .whileElement(by.id('TransactionStatusScroll'))
    .scroll(200, 'down');
  await element(by.id(id)).tap();
  await waitForId('FeeBumpRateInput');
  await element(by.id('FeeBumpRateInput')).replaceText(String(rate));
  if (device.getPlatform() === 'ios') {
    await element(by.text('Done')).tap();
  } else {
    await device.pressBack();
  }
  await element(by.id('FeeBumpCreateButton')).tap();
  await waitForId('FeeBumpHexInput');
  const tx = bitcoin.Transaction.fromHex(await nativeText('FeeBumpHexInput'));
  assert.ok(tx.ins.every(input => input.witness[0][input.witness[0].length - 1] === 0x21));
  await element(by.id('FeeBumpBroadcastButton')).tap();
  await waitForId('SendSuccessDone', 60_000);
  await element(by.id('SendSuccessDone')).tap();
  return tx;
}

async function unlock(password: string): Promise<void> {
  await waitForId('PasswordInput');
  await element(by.id('PasswordInput')).replaceText(password);
  await element(by.id('PasswordInput')).tapReturnKey();
}

native('continuous native live wallet lifecycle', () => {
  for (const format of ['segwit', 'taproot'] as const) {
    it(format + ' native recovery/receive/send/RBF/CPFP/confirmation/encrypted restart/delete/recovery', async () => {
      const artifactDirectory = path.join(process.cwd(), 'artifacts/native-lifecycle', device.getPlatform() + '-' + format);
      const backend = new KnotsFulcrumHarness(backendOptions(artifactDirectory));
      const profile = vectors[format];
      const label = 'Imported ' + profile.typeReadable;
      const isIOS = device.getPlatform() === 'ios';
      try {
        await backend.start();
        await backend.fundAddress(profile.receive[0], 60_000);
        await backend.fundAddress(profile.receive[1], 40_000);
        await device.clearKeychain();
        await device.launchApp({
          delete: true,
          permissions: { notifications: 'NO' },
          launchArgs: { detoxEnableSynchronization: 0 },
        });
        if (isIOS) await device.disableSynchronization();
        await configureNative(backend);

        console.info('[native-lifecycle] testing cancelled recovery');
        // A cancelled stalled scan must not silently become an empty successful recovery.
        backend.fault = 'history-timeout';
        await beginRecovery();
        await waitForId('RecoveryStopButton');
        await element(by.id('RecoveryStopButton')).tap();
        await waitForText(english.wallets.recovery_incomplete, 60_000);
        // RN Pressable disables its JS handler; native View.enabled can still
        // be true on Android. Exercise the button and assert the actual outcome.
        await waitForId('RecoveryImportSelected');
        try {
          await element(by.id('RecoveryImportSelected')).tap();
        } catch (error) {
          if (!/disabled|not enabled/i.test(String(error))) throw error;
        }
        await nativeExpect(element(by.id('RecoveryResults'))).toExist();
        await nativeExpect(element(by.text('Your wallet has been successfully imported.'))).not.toExist();
        backend.fault = 'none';
        await goBack();
        await goBack();
        await waitForWalletsList();
        await recover();
        await openWallet(label);
        assert.equal(await balanceSats(), 100_000);

        // A server reset must preserve the funded wallet until a fresh
        // authenticated connection can fetch history again.
        const beforeDisconnect = backend.receipt.disconnectFaults;
        backend.fault = 'disconnect';
        backend.disconnectClients();
        await refresh();
        await eventually(async () => backend.receipt.disconnectFaults > beforeDisconnect, 30_000);
        assert.equal(await balanceSats(), 100_000);
        backend.fault = 'none';
        backend.disconnectClients();
        const beforeReconnect = backend.receipt.forwardedMethods['blockchain.scripthash.get_history'] || 0;
        await eventually(async () => {
          await refresh();
          return (backend.receipt.forwardedMethods['blockchain.scripthash.get_history'] || 0) > beforeReconnect;
        }, 60_000);
        assert.equal(await balanceSats(), 100_000);

        await element(by.id('ReceiveButton')).tap();
        await waitForId('BitcoinAddressQRCode');
        await waitForLabel(profile.receive[2]);
        await backend.fundAddress(profile.receive[2], 50_000);
        await goBack();
        await eventually(async () => {
          await refresh();
          return (await balanceSats()) === 150_000;
        }, 60_000);

        await element(by.id('SendButton')).tap();
        await waitForId('AddressInput');
        await element(by.id('AddressInput')).replaceText(vectors.recipient);
        await element(by.id('BitcoinAmountInput')).replaceText('0.0009\n');
        await waitForKeyboardToClose();
        await setCustomFeeRate(1);
        await element(by.id('CreateTransactionButton')).tap();
        await waitForId('TransactionValue');
        await element(by.id('TransactionDetailsButton')).tap();
        const original = bitcoin.Transaction.fromHex(await nativeText('TxhexInput'));
        assert.ok(original.ins.every(input => input.witness[0][input.witness[0].length - 1] === 0x21));
        assert.equal(bitcoin.address.fromOutputScript(original.outs[0].script), vectors.recipient);
        assert.equal(original.outs[0].value, 90_000n);
        await goBack();
        await element(by.id('ConfirmBroadcastButton')).tap();
        await waitForId('SendSuccessDone', 60_000);
        assert.ok((await backend.rpc('getrawmempool')).includes(original.getId()));
        await element(by.id('SendSuccessDone')).tap();
        await waitForId('WalletTransactionsList');
        await refresh();
        await openSentTransaction(original.getId());

        const replacement = await bump('rbf', 4);
        assert.deepEqual(replacement.outs[0], original.outs[0]);
        assert.ok((await backend.rpc('getrawmempool')).includes(replacement.getId()));
        assert.ok(!(await backend.rpc('getrawmempool')).includes(original.getId()));
        await waitForId('WalletTransactionsList');
        await refresh();
        await openSentTransaction(replacement.getId());

        const child = await bump('cpfp', 10);
        assert.ok((await backend.rpc('getrawmempool')).includes(child.getId()));
        assert.ok(child.ins.some(input => Buffer.from(input.hash).reverse().toString('hex') === replacement.getId()));
        await backend.mine(2);
        for (const tx of [replacement, child]) assert.equal((await backend.rpc('getrawtransaction', [tx.getId(), true])).confirmations, 2);
        await waitForId('WalletTransactionsList');
        await refresh();
        await openSentTransaction(child.getId());
        await waitFor(element(by.text(/2 confirmations/i)))
          .toExist()
          .withTimeout(60_000);
        await goBack();
        const retainedBalance = await balanceSats();
        await goBack();
        await waitForWalletsList();

        await element(by.id('SettingsButton')).tap();
        await element(by.id('SecurityButton')).tap();
        await element(by.id('EncyptedAndPasswordProtectedSwitch')).tap();
        await element(by.id('IUnderstandButton')).tap();
        await waitForId('PasswordInput');
        await element(by.id('PasswordInput')).replaceText(fixturePassword);
        await element(by.id('ConfirmPasswordInput')).replaceText(fixturePassword);
        await element(by.id('ConfirmPasswordInput')).tapReturnKey();
        await confirmPasswordDialog();
        await waitFor(element(by.id('ConfirmPasswordInput')))
          .not.toExist()
          .withTimeout(120_000);
        await waitForId('PlausibleDeniabilityButton');
        // No new history can arrive during this restart/cache assertion.
        backend.fault = 'history-timeout';
        backend.disconnectClients();
        await device.launchApp({
          newInstance: true,
          launchArgs: { detoxEnableSynchronization: 0 },
        });
        if (isIOS) await device.disableSynchronization();
        await unlock('wrong-fixture-password');
        await waitForText('Incorrect password. Please, try again.');
        assert.equal(await dismissAlertByText('OK', 10_000, false), true);
        await unlock(fixturePassword);
        await waitForWalletsList();
        await openWallet(label);
        assert.equal(await balanceSats(), retainedBalance);
        await openSentTransaction(child.getId()); // real native history cache survived encryption/restart
        await goBack();

        backend.fault = 'none';
        backend.disconnectClients();
        await element(by.id('HeaderMenuButton')).tap();
        await element(by.text('Details')).tap();
        await waitForId('WalletDetailsScroll');
        await waitFor(element(by.id('DeleteWallet')))
          .toBeVisible()
          .whileElement(by.id('WalletDetailsScroll'))
          .scroll(500, 'down');
        await element(by.id('DeleteWallet')).tap();
        assert.equal(await dismissAlertByText('Yes, delete', 10_000, false), true);
        await typeTextIntoAlertInput(String(retainedBalance));
        assert.equal(await dismissAlertByText('Delete', 10_000, false), true);
        await waitForWalletsList();
        await nativeExpect(element(by.id(label))).not.toExist();
        await recover();
        await openWallet(label);
        assert.equal(await balanceSats(), retainedBalance);
        await openSentTransaction(child.getId());

        mkdirSync(artifactDirectory, { recursive: true });
        writeFileSync(
          path.join(artifactDirectory, 'native-receipt.json'),
          JSON.stringify(
            {
              sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
                encoding: 'utf8',
              }).trim(),
              platform: device.getPlatform(),
              format,
              hostedNativeUi: true,
              physicalPhone: false,
              coldDeviceInteroperability: false,
              checkpointAdapted: true,
              verboseAddressLabelsAdapted: true,
              original: original.getId(),
              replacement: replacement.getId(),
              child: child.getId(),
              confirmations: 2,
              encryptedHistoryPreserved: true,
              deletionRecoveryPassed: true,
              height: await backend.rpc('getblockcount'),
            },
            null,
            2,
          ) + '\n',
        );
      } catch (error) {
        // Record the original failure before diagnostics/teardown can fail.
        console.error('[native-lifecycle] original failure:', error);
        await boundedDiagnostic(() => device.takeScreenshot('native-live-lifecycle-failure'));
        throw error;
      } finally {
        // Cleanup the real backend even when Detox has lost its app connection.
        // Re-enabling synchronization after termination targets a dead app and
        // used to mask the original error and leave backend children running.
        await backend.stop();
        await boundedDiagnostic(() => device.terminateApp());
      }
    });
  }
});
