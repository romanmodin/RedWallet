/**
 * Actual iOS app/socket/clipboard/UI qualification, simulated external signer.
 * Requires a deliberately overlaid simulator-only binary and disposable nodes.
 * Does NOT qualify camera optics, physical Keystone or independent explorers.
 */
import assert from 'assert';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import { CryptoPSBT } from '@keystonehq/bc-ur-registry';
import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import { createHardwareSigningFixture } from '../../class/hardware/offline-signing';
import { captureRenderedPsbt } from '../native/capture-rendered-psbt';
import { by, device, element, expect as nativeExpect, waitFor } from 'detox';
import {
  dismissAlertByText,
  enterMnemonicText,
  getSwitchValue,
  goBack,
  setCustomFeeRate,
  sleep,
  waitForId,
  waitForKeyboardToClose,
  waitForText,
  waitForWalletsList,
  waitForSwitchValue,
} from './lifecycle-helperz';
import { launchNativeClean } from './launch-native-clean';
import { StandardHardwareNativeFixture, PUBLIC_WATCH_ACCOUNT, PUBLIC_RECIPIENT } from '../native/standard-hardware-fixture';
import english from '../../loc/en.json';
import { XBT_ELECTRUM_PRESETS } from '../../class/xbt/electrum-presets';
import { runWithNativeReceipt } from '../native/native-test-receipt';
import { settleIosHostKeyboard } from './tls-host-keyboard';
import { tapAfterTransition } from '../native/tap-after-transition';
import { eventually } from '../native/knots-fulcrum-harness';

const enabled = process.env.REDWALLET_STANDARD_NATIVE === '1';
const suite = enabled ? describe : describe.skip;
const artifacts = path.resolve('artifacts/standard-hardware-native');
const step = (label: string) => console.info('[standard-native] ' + label);
const hostField = (value = XBT_ELECTRUM_PRESETS[0].host) =>
  element(by.type('RCTUITextField').and((by as typeof by & { value(text: string): ReturnType<typeof by.id> }).value(value)));
async function visible(id: string, scroll: string) {
  const target = id === 'HostInput' ? hostField() : element(by.id(id));
  await waitFor(target).toExist().withTimeout(30000);
  await waitFor(target).toBeVisible().whileElement(by.id(scroll)).scroll(150, 'down', 0.95, 0.5);
}
async function text(id: string): Promise<string> {
  const a = (await element(by.id(id)).getAttributes()) as unknown as Record<string, unknown>;
  for (const key of ['text', 'value', 'label']) if (typeof a[key] === 'string') return a[key] as string;
  throw new Error('Missing native text ' + id);
}
async function confirmDialog(title: string, accept: boolean) {
  await waitForText(title, 15000);
  assert.equal(await dismissAlertByText(accept ? english._.yes : english._.cancel, 15000, false), true);
}
async function openSettings() {
  await waitForId('WalletDetails');
  await element(by.id('WalletDetails')).tap();
  await visible('XbtStandardHardwareSwitch', 'WalletDetailsScroll');
}
async function prepare() {
  await waitForId('CreateTransactionButton');
  await tapAfterTransition(() => element(by.id('CreateTransactionButton')).tap());
  await confirmDialog('Confirm XBT payment', true);
}

async function injectFragment(part: string) {
  await waitForId('ScanQrBackdoorButton');
  for (let i = 0; i < 6; i++) await element(by.id('ScanQrBackdoorButton')).tap();
  await waitForId('scanQrBackdoorInput');
  await element(by.id('scanQrBackdoorInput')).replaceText(part);
  // Confirm native text preservation before testing scanner/parser behavior.
  await nativeExpect(element(by.id('scanQrBackdoorInput'))).toHaveText(part);
  await element(by.id('scanQrBackdoorOkButton')).tap();
  await waitFor(element(by.id('scanQrBackdoorInput')))
    .not.toExist()
    .withTimeout(10000);
}

suite('Standard hardware iOS qualification', () => {
  it('preserves watch-only origin, requires separation, and rechecks before one native TLS broadcast', async () => {
    assert.equal(device.getPlatform(), 'ios');
    const bin = process.env.REDWALLET_BACKEND_BIN;
    assert(bin && path.isAbsolute(bin), 'Explicit disposable backend directory required');
    const fixture = new StandardHardwareNativeFixture();
    const observed: Record<string, unknown> = {};
    mkdirSync(artifacts, { recursive: true });
    await runWithNativeReceipt({
      run: async () => {
        step('starting isolated shared-history chains');
        await fixture.start({
          core: path.join(bin, 'core-bitcoind'),
          knots: path.join(bin, 'bitcoind'),
          fulcrum: path.join(bin, 'Fulcrum'),
        });
        await device.clearKeychain();
        // clearKeychain can remove the fixture CA; install only into this simulator.
        execFileSync('xcrun', ['simctl', 'keychain', device.id, 'add-root-cert', path.resolve('tests/fixtures/tls/ca.pem')]);
        await launchNativeClean(device, {
          permissions: { notifications: 'NO', camera: 'YES' },
        });
        await device.disableSynchronization();
        step('configuring real native TLS');
        await waitForWalletsList();
        await element(by.id('SettingsButton')).tap();
        await sleep(12000);
        await waitForId('SettingsRoot');
        step('checking offline signing through rendered QR pixels and returned fragments');
        await visible('Tools', 'SettingsRoot');
        await element(by.id('Tools')).tap();
        await waitForId('HardwareSigningCheckTool');
        await element(by.id('HardwareSigningCheckTool')).tap();
        await waitForId('HardwareCheckScanAccount');
        // Disposable public vector only, held by the host and never imported as a seed.
        const offlineMaster = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, 1));
        const offlinePath = "m/84'/0'/0'";
        const offlineNode = offlineMaster.derivePath(offlinePath);
        const offlineAccount = {
          fingerprint: Buffer.from(offlineMaster.fingerprint).toString('hex'),
          accountPath: offlinePath,
          xpub: offlineNode.neutered().toBase58(),
        };
        await element(by.id('HardwareCheckScanAccount')).tap();
        await injectFragment(JSON.stringify(offlineAccount));
        observed.offlineAccountInputExact = true;
        await nativeExpect(element(by.id('HardwareCheckError'))).not.toExist();
        await visible('HardwareCheckShowRequest', 'HardwareSigningCheck');
        await element(by.id('HardwareCheckShowRequest')).tap();
        // The noninteractive wrapper reports invisible even with its entire QR
        // on screen (run 44005700815). Judge visibility by decoding actual pixels,
        // not the wrapper's hit-testing/visibility heuristic.
        await waitFor(element(by.id('HardwareCheckRequest')))
          .toExist()
          .withTimeout(30000);
        await element(by.id('HardwareSigningCheck')).scrollTo('bottom');
        const rendered = await captureRenderedPsbt(name => device.takeScreenshot(name), {
          showControls: async () => {
            // The controls mount below the QR inside the same ScrollView, so they
            // are off-screen until the content grows and the view is scrolled again.
            await element(by.id('DynamicCode')).tap();
            const toggle = element(by.id('DynamicQRStopStart'));
            let toggleVisible = false;
            await eventually(async () => {
              const attrs = (await toggle.getAttributes()) as { label?: string; visible?: boolean };
              toggleVisible = attrs.visible === true;
              return attrs.label === english.send.dynamic_stop;
            });
            if (!toggleVisible) {
              await waitFor(toggle).toBeVisible().whileElement(by.id('HardwareSigningCheck')).scroll(150, 'down', 0.95, 0.5);
            }
          },
          stop: async () => {
            // Tap Stop exactly once, then confirm the button now reads "Start".
            await element(by.id('DynamicQRStopStart')).tap();
            await waitFor(element(by.text('Start')))
              .toExist()
              .withTimeout(5000);
          },
          next: async () => {
            await element(by.id('DynamicQRNext')).tap();
          },
          label: async () => {
            const attrs = (await element(by.id('DynamicQRFragmentLabel')).getAttributes()) as { text?: string; label?: string };
            return attrs.text ?? attrs.label ?? '';
          },
        });
        assert.equal(rendered.psbt.toHex(), createHardwareSigningFixture(offlineAccount, 'send').request.toHex());
        assert.equal(rendered.psbt.inputCount, 3);
        observed.offlineQrPixelDecode = true;
        observed.offlineQrScreenshotCount = rendered.images;
        // An unsigned return must show failure before the real signature is tried.
        await visible('HardwareCheckScanSignature', 'HardwareSigningCheck');
        await element(by.id('HardwareCheckScanSignature')).tap();
        await injectFragment(rendered.psbt.toBase64());
        await waitForId('HardwareCheckFailed');
        await nativeExpect(element(by.id('HardwareCheckPassed'))).not.toExist();
        observed.offlineUnsignedReturnRejected = true;
        const offlineSigned = rendered.psbt.clone();
        offlineSigned.txInputs.forEach((_, index) => offlineSigned.signInput(index, offlineNode.derive(0).derive(index)));
        const offlineEncoder = new CryptoPSBT(Buffer.from(offlineSigned.toBuffer())).toUREncoder(175);
        const offlineParts = Array.from({ length: offlineEncoder.fragmentsLength }, () => offlineEncoder.nextPart().toUpperCase());
        await visible('HardwareCheckScanSignature', 'HardwareSigningCheck');
        await element(by.id('HardwareCheckScanSignature')).tap();
        for (const part of offlineParts.reverse()) await injectFragment(part);
        await waitForId('HardwareCheckPassed');
        await nativeExpect(element(by.id('HardwareCheckFailed'))).not.toExist();
        assert.deepEqual(fixture.transport.broadcasts, []);
        observed.offlineSigningCheckPassed = true;
        observed.offlineInputsSigned = offlineSigned.inputCount;
        await goBack();
        await goBack();
        await waitForId('SettingsRoot');
        await visible('NetworkSettings', 'SettingsRoot');
        await element(by.id('NetworkSettings')).tap();
        await waitForId('ElectrumSettings');
        await element(by.id('ElectrumSettings')).tap();
        await waitForId('ElectrumConnectionEnabledSwitch');
        if (await getSwitchValue('ElectrumConnectionEnabledSwitch')) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
        // iOS omits the host's testID; match the observed default native value.
        await visible('HostInput', 'ElectrumSettingsScrollView');
        await hostField().replaceText('127.0.0.1');
        await settleIosHostKeyboard({ device, element, by, waitFor }, '127.0.0.1');
        await visible('PortInput', 'ElectrumSettingsScrollView');
        await element(by.id('PortInput')).replaceText(String(fixture.transport.port));
        await visible('SSLPortInput', 'ElectrumSettingsScrollView');
        if (!(await getSwitchValue('SSLPortInput'))) await element(by.id('SSLPortInput')).tap();
        await visible('TlsCaInput', 'ElectrumSettingsScrollView');
        await element(by.id('TlsCaInput')).replaceText(fixture.transport.ca);
        await element(by.id('TlsCaInput')).tapReturnKey();
        await element(by.id('ElectrumSettingsScrollView')).scrollTo('bottom', 0.95, 0.5);
        await visible('Save', 'ElectrumSettingsScrollView');
        await element(by.id('Save')).tap();
        await waitForText(
          'Your changes have been saved successfully. Restarting RedWallet may be required for the changes to take effect.',
        );
        assert.equal(await dismissAlertByText('OK', 15000, false), true);
        // Wait for the dismissed alert to stop intercepting the underlying form.
        await eventually(async () => {
          await hostField('127.0.0.1').tap();
          return true;
        }, 15000);
        await settleIosHostKeyboard({ device, element, by, waitFor }, '127.0.0.1');
        await goBack();
        await goBack();
        await goBack();

        step('importing public account only');
        await waitForWalletsList();
        await waitForId('CreateAWallet');
        await element(by.id('CreateAWallet')).tap();
        await waitForId('ImportWallet');
        await element(by.id('ImportWallet')).tap();
        await waitForId('MnemonicInput');
        await enterMnemonicText(PUBLIC_WATCH_ACCOUNT);
        await element(by.id('DoImport')).tap();
        await waitForText(
          'Your wallet has been successfully imported. WARNING: This is a watch-only wallet, you can NOT spend from it.',
          90000,
        );
        assert.equal(await dismissAlertByText('OK', 15000, false), true);
        await waitForId('Imported Watch-only', 60000);
        await element(by.id('Imported Watch-only')).tap();
        await waitForId('WalletBalance', 60000);
        await waitFor(element(by.id('WalletBalance')))
          .toHaveText('0.00999')
          .withTimeout(90000);
        assert(fixture.transport.checkpointRequests > 0);
        assert((fixture.transport.counts['blockchain.scripthash.get_history'] || 0) > 0);
        assert(fixture.transport.tlsConnections > 0);

        step('checking opt-in cancellation and persistence');
        await openSettings();
        await waitForSwitchValue('XbtStandardHardwareSwitch', false);
        await tapAfterTransition(() => element(by.id('XbtStandardHardwareSwitch')).tap());
        await confirmDialog('Standard hardware signing', false);
        await waitForSwitchValue('XbtStandardHardwareSwitch', false);
        await tapAfterTransition(() => element(by.id('XbtStandardHardwareSwitch')).tap());
        await confirmDialog('Standard hardware signing', true);
        await waitForSwitchValue('XbtStandardHardwareSwitch', true);
        await element(by.id('WalletDetailsScroll')).scrollTo('top');
        await visible('XbtExternalSignerSwitch', 'WalletDetailsScroll');
        await waitForSwitchValue('XbtExternalSignerSwitch', false);
        await element(by.id('XbtExternalSignerSwitch')).tap();
        await confirmDialog('Enable XBT external signing', true);
        await waitForSwitchValue('XbtExternalSignerSwitch', true);
        await device.launchApp({ newInstance: true });
        await device.disableSynchronization();
        await waitForWalletsList();
        await element(by.id('Imported Watch-only')).tap();
        await openSettings();
        await waitForSwitchValue('XbtStandardHardwareSwitch', true);
        await element(by.id('WalletDetailsScroll')).scrollTo('top');
        await visible('XbtExternalSignerSwitch', 'WalletDetailsScroll');
        await waitForSwitchValue('XbtExternalSignerSwitch', true);
        await goBack();

        step('blocking PSBT without conflicting spend proof');
        await waitForId('SendButton');
        await element(by.id('SendButton')).tap();
        await waitForId('AddressInput');
        await element(by.id('AddressInput')).typeText(PUBLIC_RECIPIENT + '\n');
        await waitForKeyboardToClose();
        await element(by.id('BitcoinAmountInput')).replaceText('0.001\n');
        await waitForKeyboardToClose();
        await setCustomFeeRate(2);
        await prepare();
        await waitForText('Coin separation could not be verified. Standard signing is blocked.', 60000);
        assert.equal(await dismissAlertByText('OK', 15000, false), true);
        await nativeExpect(element(by.id('PSBTHex'))).not.toExist();
        assert.deepEqual(fixture.transport.broadcasts, []);
        observed.missingProofBlocked = true;

        step('blocking redirects and bounded-response failures over real native HTTPS');
        for (const mode of ['redirect', 'oversized', 'slow'] as const) {
          fixture.proof = mode;
          const before = fixture.explorerRequests.length;
          const beforeFault = fixture.faultResponses[mode];
          const started = Date.now();
          await prepare();
          // The JS 8s abort starts before native admission. Either deadline may
          // win; both must block. Redirect/size faults must report failure.
          const messages = ['Separation evidence request failed'];
          if (mode === 'slow') messages.push('Separation evidence request canceled');
          await eventually(async () => {
            for (const message of messages) {
              try {
                await nativeExpect(element(by.text(message))).toBeVisible();
                return true;
              } catch {
                /* Observe the other exact failure message on the next check. */
              }
            }
            return false;
          }, 30000);
          assert.equal(await dismissAlertByText('OK', 15000, false), true);
          assert(fixture.explorerRequests.length > before, mode + ' reached the TLS fixture');
          assert(fixture.faultResponses[mode] > beforeFault, mode + ' emitted its own TLS fault response');
          assert.deepEqual(fixture.transport.broadcasts, []);
          await nativeExpect(element(by.id('PSBTHex'))).not.toExist();
          if (mode === 'slow') observed.nativeHTTPTimeoutElapsedMs = Date.now() - started;
        }
        assert(fixture.redirectResponses > 0);
        assert.equal(fixture.redirectProbeRequests, 0);
        assert(fixture.malformedResponses >= 2);
        observed.nativeHTTPSFaultResponses = { ...fixture.faultResponses };
        observed.nativeHTTPSRedirectBlocked = true;
        observed.nativeHTTPSRedirectProbeRequests = fixture.redirectProbeRequests;
        observed.nativeHTTPSChunkLimitBlocked = true;
        observed.nativeHTTPSDeadlineBlocked = true;

        step('exporting PSBT through the app clipboard');
        fixture.proof = 'valid';
        await prepare();
        await waitForId('StandardHardwareSigningNotice', 60000);
        await visible('TextHelperForPSBT', 'PsbtWithHardwareScrollView');
        await visible('CopyUnsignedPsbtButton', 'PsbtWithHardwareScrollView');
        await element(by.id('CopyUnsignedPsbtButton')).tap();
        const encoded = execFileSync('xcrun', ['simctl', 'pbpaste', device.id], {
          encoding: 'utf8',
        }).trim();
        const request = bitcoin.Psbt.fromBase64(encoded);
        const signed = fixture.sign(request);
        observed.masterFingerprint = Buffer.from(request.data.inputs[0].bip32Derivation![0].masterFingerprint).toString('hex');
        observed.sighashType = request.data.inputs[0].sighashType;
        observed.clipboardRoundTrip = true;
        // Inject real animated QR fragments through the existing scanner input.
        // This exercises assembly/navigation, not camera optics or device signing.
        const qrParts = (value: bitcoin.Psbt) => {
          const encoder = new CryptoPSBT(Buffer.from(value.toBuffer())).toUREncoder(175);
          return Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart().toUpperCase());
        };
        const parts = qrParts(signed);
        const abandonedParts = qrParts(request);
        assert(parts.length > 1 && abandonedParts.length > 1);
        assert.notEqual(parts.join(), abandonedParts.join());
        await element(by.id('PsbtWithHardwareScrollView')).scrollTo('top');
        await visible('PsbtTxScanButton', 'PsbtWithHardwareScrollView');
        await element(by.id('PsbtTxScanButton')).tap();
        await injectFragment(abandonedParts[0]);
        await waitForId('UrProgressBar');
        await nativeExpect(element(by.id('SignedTransactionHex'))).not.toExist();
        await waitForId('ScanQrCancelButton');
        await element(by.id('ScanQrCancelButton')).tap();
        await waitForId('PsbtTxScanButton');
        await tapAfterTransition(() => element(by.id('PsbtTxScanButton')).tap());
        for (const part of [...parts].reverse()) await injectFragment(part);
        observed.animatedQrFragmentCount = parts.length;
        observed.canceledQrSessionDiscarded = true;
        await waitForId('SignedTransactionHex');
        const hex = await text('SignedTransactionHex');
        assert.equal(bitcoin.Transaction.fromHex(hex).ins[0].witness[0].at(-1), 1);
        assert.deepEqual(fixture.transport.broadcasts, []);

        step('blocking stale separation after a real Core reorg');
        await fixture.reorg(true);
        await visible('PsbtWithHardwareWalletBroadcastTransactionButton', 'SignedTransactionScroll');
        await element(by.id('PsbtWithHardwareWalletBroadcastTransactionButton')).tap();
        await waitForText('Coin separation could not be verified. Standard signing is blocked.', 60000);
        assert.equal(await dismissAlertByText('OK', 15000, false), true);
        assert.deepEqual(fixture.transport.broadcasts, []);
        assert.equal(await text('SignedTransactionHex'), hex);
        observed.reorgBeforeBroadcastBlocked = true;

        step('retrying the unchanged reviewed transaction with restored proof');
        await fixture.reorg(false);
        await element(by.id('SignedTransactionScroll')).scrollTo('bottom');
        await visible('PsbtWithHardwareWalletBroadcastTransactionButton', 'SignedTransactionScroll');
        await element(by.id('PsbtWithHardwareWalletBroadcastTransactionButton')).tap();
        await waitForId('SendSuccessDone', 60000);
        assert.deepEqual(fixture.transport.broadcasts, [hex]);
        Object.assign(observed, await fixture.settle(hex));
        observed.broadcastCount = 1;
        observed.nativeElectrumMethods = fixture.transport.counts;
        observed.nativeTlsConnections = fixture.transport.tlsConnections;
        observed.explorerCalls = fixture.explorerRequests.length;
        assert(fixture.explorerRequests.some(call => call.provider === 'evidence'));
        assert(fixture.explorerRequests.some(call => call.provider === 'anchor'));
      },
      cleanup: () => fixture.stop(),
      writeReceipt: outcome => {
        writeFileSync(
          path.join(artifacts, 'receipt.json'),
          JSON.stringify(
            {
              sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
                encoding: 'utf8',
              }).trim(),
              observedAt: new Date().toISOString(),
              testSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
              cleanupComplete: fixture.cleanupComplete,
              ...observed,
              ...outcome,
              limitations:
                'Simulator-only build overlay. Public test seed held by host signer, not app. Explorer HTTPS routes share one Core node. Scanner text injection, not camera. No physical Keystone or real funds.',
            },
            null,
            2,
          ) + '\n',
        );
      },
    });
  }, 22 * 60 * 1000);
});
