import assert from 'assert';
import * as bitcoin from 'bitcoinjs-lib';
import { element, waitFor } from 'detox';

import {
  confirmPasswordDialog,
  dismissAlertByText,
  expectToBeVisible,
  extractTextFromElementById,
  goBack,
  hashIt,
  helperCreateWallet,
  helperDeleteWallet,
  scanText,
  scrollUpOnHomeScreen,
  setCustomFeeRate,
  sleep,
  tapAndTapAgainIfElementIsNotVisible,
  tapIfTextPresent,
  waitForId,
  waitForWalletsList,
  waitForKeyboardToClose,
  waitForText,
  waitForLabel,
} from './helperz';

// iOS secure keyboard animations can keep Detox busy after a return-key
// action. Dismiss the keyboard with synchronization off, then use the dialog
// button and bounded destination checks before restoring synchronization.
async function submitStoragePassword(password, confirmation, settled) {
  const isIOS = device.getPlatform() === 'ios';
  if (isIOS) await device.disableSynchronization();
  try {
    await waitForId('PasswordInput');
    await element(by.id('PasswordInput')).replaceText(password);
    if (confirmation) {
      await waitForId('ConfirmPasswordInput');
      await element(by.id('ConfirmPasswordInput')).replaceText(password);
    }
    if (isIOS) {
      await element(by.id(confirmation ? 'ConfirmPasswordInput' : 'PasswordInput')).tapReturnKey();
    }
    await confirmPasswordDialog();
    await settled();
  } finally {
    if (isIOS) await device.enableSynchronization();
  }
}

// if loglevel is set to `error`, this kind of logging will still get through
console.warn = console.log = (...args) => {
  let output = '';
  args.map(arg => (output += String(arg)));

  process.stdout.write('\n\t\t' + output + '\n');
};

/**
 * this testsuite is for test cases that require no wallets to be present
 */
describe('RedWallet UI Tests - no wallets', () => {
  it('selftest passes', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t1');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t1'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();

    // go to settings, press SelfTest and wait for OK
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('AboutButton')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(500, 'down');
    await element(by.id('AboutButton')).tap();
    // Ensure About has mounted before scrolling — race seen on cold launches
    // where the scroll fires before the FlatList is in the view hierarchy.
    await waitFor(element(by.id('AboutScrollView')))
      .toBeVisible()
      .withTimeout(15_000);
    await waitFor(element(by.id('RunSelfTestButton')))
      .toBeVisible()
      .whileElement(by.id('AboutScrollView'))
      .scroll(500, 'down'); // in case emu screen is small and it doesnt fit
    await tapAndTapAgainIfElementIsNotVisible('RunSelfTestButton', 'SelfTestLoading');
    // Disable synchronization before START: Detox otherwise waits for the
    // CPU-heavy crypto loops to become idle before returning from the tap.
    // The explicit completion check still requires the self-test to pass.
    await device.disableSynchronization();
    try {
      await element(by.id('SelfTestLoading')).tap();
      await waitFor(element(by.id('SelfTestOk')))
        .toBeVisible()
        .withTimeout(300 * 1000);
      console.log('[wallet-e2e] self-test completed successfully');
    } catch (error) {
      await device.takeScreenshot('selftest-failure-before-restart').catch(() => {});
      throw error;
    } finally {
      // Detox's AsyncStorage idle callback can deadlock with Espresso when
      // resources are registered again in the same process. Restart after the
      // completion assertion, then restore synchronization on the fresh app.
      await device.launchApp({ newInstance: true });
      await device.enableSynchronization();
    }
    await waitForWalletsList();
    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  it('all settings screens work', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t2');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t2'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'YES' } }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();

    // go to settings, press SelfTest and wait for OK
    await element(by.id('SettingsButton')).tap();

    await element(by.id('GeneralSettings')).tap();
    await waitForId('GeneralSettingsScreen');

    // trigger switches
    await waitForId('ClipboardSwitch');
    await element(by.id('ClipboardSwitch')).tap();
    await element(by.id('ClipboardSwitch')).tap();
    await element(by.id('QuickActionsSwitch')).tap();
    await element(by.id('QuickActionsSwitch')).tap();
    await goBack();

    //
    // Legacy BTC currency selection is hidden; XBT quotes use the separate price setting.
    await expect(element(by.id('Currency'))).not.toExist();

    // language
    // change language to Chinese (ZH), test it and switch back to English
    await element(by.id('Language')).tap();
    await element(by.id('LanguageFlatList')).scroll(250, 'down');
    await element(by.text('Chinese (ZH)')).tap();
    await goBack();
    await expect(element(by.text('语言'))).toBeVisible();
    await element(by.id('Language')).tap();
    await element(by.text('English')).tap();
    await goBack();

    // security
    await element(by.id('SecurityButton')).tap();
    await goBack();

    // network
    await element(by.id('NetworkSettings')).tap();
    await waitForId('ElectrumSettings');

    // network -> electrum server
    // change electrum server to electrum.blockstream.info and revert it back
    // skip this test on iOS. HeaderMenuButton tap triggers a keyboard open for some reason.
    if (device.getPlatform() === 'android') {
      await element(by.id('ElectrumSettings')).tap();
      await waitFor(element(by.id('HostInput')))
        .toBeVisible()
        .whileElement(by.id('ElectrumSettingsScrollView'))
        .scroll(500, 'down'); // in case emu screen is small and it doesnt fit
      await element(by.id('HostInput')).replaceText('electrum.blockstream.info\n');
      await waitForKeyboardToClose();
      await element(by.id('PortInput')).replaceText('50001\n');
      await waitForKeyboardToClose();
      await waitFor(element(by.id('Save')))
        .toBeVisible()
        .whileElement(by.id('ElectrumSettingsScrollView'))
        .scroll(500, 'down'); // in case emu screen is small and it doesnt fit
      await element(by.id('Save')).tap();
      await waitForText(
        'Cannot connect to the provided Electrum server. TLS requires a trusted certificate matching the server name. XBT servers must also match the mainnet checkpoint.',
      );
      await element(by.text('OK')).tap();

      // Bitcoin-only servers must not be accepted for the XBT profile.
      await element(by.id('HostInput')).clearText();
      await element(by.id('PortInput')).clearText();
      await goBack();
    }

    // network -> lightning
    // change URI and revert it back
    /* muted since https://lndhub.herokuapp.com is down
    await element(by.id('LightningSettings')).tap();
    await element(by.id('URIInput')).replaceText('invalid\n');
    await element(by.id('Save')).tap();
    await waitForText('OK');
    await expect(element(by.text('Invalid LNDHub URI'))).toBeVisible();
    await element(by.text('OK')).tap();
    await element(by.id('URIInput')).replaceText('https://lndhub.herokuapp.com\n');
    await element(by.id('Save')).tap();
    await waitForText('OK');
    await expect(element(by.text('Your changes have been saved successfully.'))).toBeVisible();
    await element(by.text('OK')).tap();
    await element(by.id('URIInput')).replaceText('\n');
    await element(by.id('Save')).tap();
    await waitForText('OK');
    await expect(element(by.text('Your changes have been saved successfully.'))).toBeVisible();
    await element(by.text('OK')).tap();
    await goBack();
    */

    // notifications
    if (await expectToBeVisible('NotificationSettings')) {
      await element(by.id('NotificationSettings')).tap();
      await waitFor(element(by.id('NotificationsSwitch')))
        .toBeVisible()
        .withTimeout(10000);

      // Toggle notifications on/off. On iOS 26 simulators notifications are always
      // denied, triggering a native UIAlertController whose buttons liquid glass
      // can make un-tappable by Detox. If the alert cannot be dismissed, relaunch
      // the app to recover instead of failing the entire settings test.
      let notifDialogStuck = false;
      try {
        await element(by.id('NotificationsSwitch')).tap();
        const dismissed1 = await dismissAlertByText('OK', 10000);
        if (dismissed1) {
          await sleep(500);
          await element(by.id('NotificationsSwitch')).tap();
          await dismissAlertByText('OK', 10000);
        } else {
          notifDialogStuck = true;
        }
      } catch (e) {
        console.warn('Notifications toggle skipped due to alert interaction issue:', e.message);
        notifDialogStuck = true;
      }

      if (notifDialogStuck) {
        // Dialog blocks all interaction; relaunch the app to clear it
        await device.launchApp({ newInstance: true });
        await waitForWalletsList();
        await element(by.id('SettingsButton')).tap();
      } else {
        await goBack();
        await goBack();
      }
    } else {
      await goBack();
    }

    // tools
    await element(by.id('Tools')).tap();

    // tools -> broadcast
    // try to broadcast wrong tx
    await element(by.id('Broadcast')).tap();
    await element(by.id('TxHex')).replaceText('invalid\n');
    await waitForKeyboardToClose();
    await element(by.id('BroadcastButton')).tap();
    await waitForText('OK');
    // await expect(element(by.text('the transaction was rejected by network rules....'))).toBeVisible();
    await element(by.text('OK')).tap();
    await goBack();

    // IsItMyAddress
    await element(by.id('IsItMyAddress')).tap();
    await waitForId('AddressInput');
    await element(by.id('AddressInput')).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('CheckAddress')).tap();
    await expect(element(by.text('None of the available wallets own the provided address.'))).toBeVisible();
    await element(by.text('OK')).tap();
    await goBack();
    await goBack();

    // about
    await waitFor(element(by.id('AboutButton')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(500, 'down');
    await element(by.id('AboutButton')).tap();
    await goBack();
    await goBack();
    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  it('can create wallet, reload app and it persists. then go to receive screen, set custom amount and label. Dismiss modal and go to WalletsList.', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t3');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t3'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();

    await helperCreateWallet();

    await device.launchApp({ newInstance: true, permissions: { notifications: 'YES' } });
    await waitForWalletsList();
    await expect(element(by.id('cr34t3d'))).toBeVisible();
    await tapAndTapAgainIfElementIsNotVisible('cr34t3d', 'ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await element(by.text('Yes, I have.')).tap();
    await waitForId('BitcoinAddressQRCode');
    await waitForId('CopyTextToClipboard');
    await element(by.id('SetCustomAmountButton')).tap();
    await element(by.id('BitcoinAmountInput')).replaceText('1');
    await element(by.id('CustomAmountDescription')).replaceText('test');
    await element(by.id('CustomAmountDescription')).tapReturnKey();
    await waitForKeyboardToClose();
    await tapAndTapAgainIfElementIsNotVisible('CustomAmountSaveButton', 'CustomAmountDescriptionText');
    await expect(element(by.id('CustomAmountDescriptionText'))).toHaveText('test');
    await expect(element(by.id('BitcoinAmountText'))).toHaveText('1 XBT');

    await waitForId('BitcoinAddressQRCode');
    await waitForId('CopyTextToClipboard');

    // ManageWallets: relaunch to clear receive modal, then open via long-press, swipe-to-hide, verify persists across restart
    await device.launchApp({ newInstance: true });
    await waitForWalletsList();
    await element(by.id('cr34t3d')).longPress();
    await waitForId('NavigationCloseButton');
    await expect(element(by.id('cr34t3d'))).toBeVisible();

    // swipe wallet row left to reveal Hide action; tap it
    await element(by.id('cr34t3d')).swipe('left', 'slow', 0.6);
    await waitForId('SwipeHideBalance');
    await element(by.id('SwipeHideBalance')).tap();
    await element(by.id('NavigationCloseButton')).tap();
    await waitForWalletsList();

    // restart app — hide state must persist; swipe-left now exposes "Show" (hideBalance persisted as true)
    await device.launchApp({ newInstance: true });
    await waitForWalletsList();
    await element(by.id('cr34t3d')).longPress();
    await waitForId('NavigationCloseButton');
    await element(by.id('cr34t3d')).swipe('left', 'slow', 0.6);
    await waitForId('SwipeShowBalance');

    // restore visible state so subsequent tests are clean
    await element(by.id('SwipeShowBalance')).tap();
    await element(by.id('NavigationCloseButton')).tap();
    await waitForWalletsList();

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  it('can encrypt storage, with plausible deniabilityl decrypt fake storage', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t4');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t4'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();

    // lets create a wallet
    await helperCreateWallet();

    // go to settings
    await expect(element(by.id('SettingsButton'))).toBeVisible();
    await element(by.id('SettingsButton')).tap();
    await expect(element(by.id('SecurityButton'))).toBeVisible();

    // go to Security page where we will enable encryption
    await element(by.id('SecurityButton')).tap();
    // await expect(element(by.id('EncyptedAndPasswordProtected'))).toBeVisible();
    await expect(element(by.id('PlausibleDeniabilityButton'))).toBeNotVisible();

    // lets encrypt the storage.
    // first, trying to mistype second password:
    await element(by.id('EncyptedAndPasswordProtectedSwitch')).tap();
    await element(by.id('IUnderstandButton')).tap();

    await element(by.id('PasswordInput')).replaceText('08902');
    await element(by.id('PasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await element(by.id('ConfirmPasswordInput')).replaceText('666');
    await element(by.id('ConfirmPasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await confirmPasswordDialog();

    // now, lets put correct passwords and encrypt the storage
    await element(by.id('PasswordInput')).clearText();
    await element(by.id('PasswordInput')).replaceText('qqq');
    await element(by.id('PasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await element(by.id('ConfirmPasswordInput')).clearText();
    await element(by.id('ConfirmPasswordInput')).replaceText('qqq');
    await element(by.id('ConfirmPasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await confirmPasswordDialog(); // might not always work the first time
    // The memory-hard KDF is asynchronous; do not terminate an unfinished save.
    await waitForId('PlausibleDeniabilityButton', 120_000);

    // relaunch app
    await device.launchApp({ newInstance: true });

    // trying to decrypt with incorrect password
    await waitForId('PasswordInput');
    await element(by.id('PasswordInput')).typeText('wrong\n');
    await waitForKeyboardToClose();
    await sleep(1000); // wait for shake animation and retry

    // correct password
    await element(by.id('PasswordInput')).typeText('qqq\n');
    await waitForKeyboardToClose();
    await waitForWalletsList();

    // previously created wallet should be visible
    await expect(element(by.id('cr34t3d'))).toBeVisible();

    // now lets enable plausible deniability feature

    // go to settings -> security screen -> plausible deniability screen
    await element(by.id('SettingsButton')).tap();
    await expect(element(by.id('SecurityButton'))).toBeVisible();
    await element(by.id('SecurityButton')).tap();
    // await expect(element(by.id('EncyptedAndPasswordProtected'))).toBeVisible();
    await expect(element(by.id('PlausibleDeniabilityButton'))).toBeVisible();
    await element(by.id('PlausibleDeniabilityButton')).tap();

    // trying to enable plausible denability
    await element(by.id('CreateFakeStorageButton')).tap();
    await waitForId('PasswordInput');

    // trying MAIN password: should fail, obviously
    await element(by.id('PasswordInput')).clearText();
    await element(by.id('PasswordInput')).replaceText('qqq');
    await element(by.id('PasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await element(by.id('ConfirmPasswordInput')).clearText();
    await element(by.id('ConfirmPasswordInput')).replaceText('qqq');
    await element(by.id('ConfirmPasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await confirmPasswordDialog(); // first time might not always work
    await sleep(1000); // propagate
    await expect(element(by.text('Password is currently in use. Please try a different password.'))).toBeVisible();
    await element(by.text('OK')).atIndex(0).tap();

    // trying new password, but will mistype
    await element(by.id('PasswordInput')).clearText();
    await element(by.id('PasswordInput')).replaceText('passwordForFakeStorage');
    await element(by.id('PasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await element(by.id('ConfirmPasswordInput')).clearText();
    await element(by.id('ConfirmPasswordInput')).replaceText('passwordForFakeStorageWithTypo'); // retyping with typo
    await element(by.id('ConfirmPasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await confirmPasswordDialog();

    // trying new password
    await element(by.id('PasswordInput')).clearText();
    await element(by.id('PasswordInput')).replaceText('passwordForFakeStorage');
    await element(by.id('PasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await element(by.id('ConfirmPasswordInput')).clearText();
    await element(by.id('ConfirmPasswordInput')).replaceText('passwordForFakeStorage'); // retyping
    await element(by.id('ConfirmPasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await confirmPasswordDialog(); // first time might not always work
    await sleep(1000); // propagate
    await scrollUpOnHomeScreen();

    // created fake storage.
    // creating a wallet inside this fake storage
    await helperCreateWallet('fake_wallet');

    // relaunch the app, unlock with fake password, expect to see fake wallet

    // relaunch app
    await device.launchApp({ newInstance: true });
    await waitForId('PasswordInput');
    await element(by.id('PasswordInput')).typeText('qqq\n');
    await waitForKeyboardToClose();
    await waitForWalletsList();

    // previously created wallet IN MAIN STORAGE should be visible
    await expect(element(by.id('cr34t3d'))).toBeVisible();

    // relaunch app
    await device.launchApp({ newInstance: true });
    await waitForId('PasswordInput');
    await element(by.id('PasswordInput')).typeText('passwordForFakeStorage\n');
    await waitForKeyboardToClose();
    await waitForWalletsList();

    // previously created wallet in FAKE storage should be visible
    await expect(element(by.id('fake_wallet'))).toBeVisible();

    // now derypting it, to cleanup
    await element(by.id('SettingsButton')).tap();
    await element(by.id('SecurityButton')).tap();

    // correct password
    await element(by.id('EncyptedAndPasswordProtectedSwitch')).tap();
    await element(by.text('OK')).tap();
    await waitForId('PasswordInput');
    await element(by.id('PasswordInput')).replaceText('passwordForFakeStorage');
    await element(by.id('PasswordInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await confirmPasswordDialog(); // in case it didnt work first time
    await sleep(1000); // propagate
    await scrollUpOnHomeScreen();
    await expect(element(by.text('fake_wallet'))).toBeVisible();

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  it('can encrypt storage, and decrypt storage works', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t5');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t5'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();
    await helperCreateWallet();
    await element(by.id('SettingsButton')).tap();
    await element(by.id('SecurityButton')).tap();

    // lets encrypt the storage.
    // lets put correct passwords and encrypt the storage
    await element(by.id('EncyptedAndPasswordProtectedSwitch')).tap();
    await element(by.id('IUnderstandButton')).tap();
    await submitStoragePassword('pass', true, async () => {
      await waitFor(element(by.id('ConfirmPasswordInput')))
        .not.toExist()
        .withTimeout(120_000);
      await waitForId('PlausibleDeniabilityButton', 120_000);
    });
    await waitForId('PlausibleDeniabilityButton', 120_000);
    await element(by.id('PlausibleDeniabilityButton')).tap();

    // trying to enable plausible denability
    await element(by.id('CreateFakeStorageButton')).tap();
    await submitStoragePassword('fake', true, async () => {
      await waitFor(element(by.id('ConfirmPasswordInput')))
        .not.toExist()
        .withTimeout(120_000);
      await waitForWalletsList();
    });
    if (device.getPlatform() === 'ios') {
      // FIXME: WAllets does not exists on android
      await waitForId('Wallets');
    }
    await sleep(1000); // propagate
    // Match t4's flow: scroll up so the next helperCreateWallet's
    // whileElement(WalletsList).scroll('right') starts from a known
    // position. Without this, Android lands the user on a list state
    // where CreateAWallet is not visible after scroll-right and the
    // 6s tapAndTapAgainIfElementIsNotVisible budget runs out.
    await scrollUpOnHomeScreen();
    // created fake storage.
    // creating a wallet inside this fake storage
    await helperCreateWallet('fake_wallet');

    // relaunch app
    await device.launchApp({ newInstance: true });
    //
    await waitForId('PasswordInput');
    await element(by.id('PasswordInput')).typeText('pass\n');
    await waitForKeyboardToClose();
    await waitForWalletsList();

    // previously created wallet IN MAIN STORAGE should be visible
    await expect(element(by.id('cr34t3d'))).toBeVisible();

    // now go to settings, and decrypt
    await element(by.id('SettingsButton')).tap();
    await element(by.id('SecurityButton')).tap();

    // putting FAKE storage password. should not succeed
    await element(by.id('EncyptedAndPasswordProtectedSwitch')).tap();
    await element(by.text('OK')).tap();
    await submitStoragePassword('fake', false, async () => {
      await waitFor(element(by.text('Incorrect password. Please, try again.')))
        .toBeVisible()
        .withTimeout(30_000);
    });
    if (!(await dismissAlertByText('OK'))) throw new Error('Could not dismiss incorrect-password alert');
    // The rejected password must leave the real wallet protected.
    await waitForId('PasswordInput');
    await submitStoragePassword('pass', false, async () => {
      await waitFor(element(by.id('PasswordInput')))
        .not.toExist()
        .withTimeout(120_000);
      await waitForWalletsList();
    });

    // relaunch app
    await device.launchApp({ newInstance: true });
    await waitForId('cr34t3d'); // success

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  // eslint-disable-next-line jest/no-disabled-tests -- Deferred: multisig is outside the XBT BIP84 release.
  it.skip('can import 2of2 multisig using individual cosigners (1 signer, 1 xpub)', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('can import 2of2 multisig using individual cosigners (1 signer, 1 xpub)');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { camera: 'YES', notifications: 'YES' } }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right'); // in case emu screen is small and it doesnt fit
    // going to Import Wallet screen and importing Vault
    await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ActivateVaultButton');
    await element(by.id('ActivateVaultButton')).tap();
    await element(by.id('Create')).tap();
    // vault settings:
    await element(by.id('VaultAdvancedCustomize')).tap();
    await element(by.id('DecreaseN')).tap();
    await element(by.id('ModalDoneButton')).tap();

    //
    await element(by.id('LetsStart')).tap();

    // key1 - seed:
    await element(by.id('VaultCosignerImport1')).tap();
    await waitForId('ScanOrOpenFile');
    await element(by.id('ScanOrOpenFile')).tap();

    await scanText('pipe goose bottom run seed curious thought kangaroo example family coral success');
    // scan auto-imports the seed via onBarScanned and navigates back to Step2

    // key2 - xpub:
    await waitForId('VaultCosignerImport2');
    await element(by.id('VaultCosignerImport2')).tap();
    await waitForId('ScanOrOpenFile');
    await element(by.id('ScanOrOpenFile')).tap();
    await scanText(
      'ur:crypto-account/oeadcypdlouebgaolytaadmetaaddloxaxhdclaxfdyksnwkuypkfevlfzfroyiyecoeosbakbpdcldawzhtcarkwsndcphphsbsdsayaahdcxfgjyckryosmwtdptlbflonbkimlsmovolslbytonayisprvoieftgeflzcrtvesbamtaaddyotadlocsdyykaeykaeykaoykaocypdlouebgaxaaaycyttatrnolimvetsst',
    );

    // scan auto-imports the xpub via onBarScanned and navigates back to Step2
    await waitForId('CreateButton');
    await element(by.id('CreateButton')).tap();
    await waitForText('OK');
    await tapIfTextPresent('OK');
    await scrollUpOnHomeScreen();
    await waitForId('Multisig Vault');
    await element(by.id('Multisig Vault')).tap(); // go inside the wallet
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();

    await waitForLabel('bc1qmf06nt4jhvzz4387ak8fecs42k6jqygr2unumetfc7xkdup7ah9s8phlup');
    await goBack();

    await element(by.id('WalletDetails')).tap();
    await waitFor(element(by.text('Advanced')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.text('Advanced')).tap();
    await waitFor(element(by.text('2 / 2 (native segwit)')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(100, 'down');

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  // eslint-disable-next-line jest/no-disabled-tests -- Deferred: multisig and hardware signing are outside the XBT BIP84 release.
  it.skip('can import multisig setup from UR, and create tx, and sign on hw devices', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t6');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t6'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { camera: 'YES', notifications: 'YES' } }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right'); // in case emu screen is small and it doesnt fit
    // going to Import Wallet screen and importing mnemonic
    await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ImportWallet');
    await element(by.id('ImportWallet')).tap();
    await element(by.id('ScanImport')).tap();

    const urs = [
      'UR:BYTES/1OF2/J8RX04F2WJ9SSY577U30R55ELM4LUCJCXJVJTD60SYV9A286Q0AQH7QXL6/TYQMJGEQGFK82E2HV9KXCET5YPXH2MR5D9EKJEEQWDJHGATSYPNXJMR9PG3JQARGD9EJQENFD3JJQCM0DE6XZ6TWWVSX7MNV0YS8QATZD35KXGRTV4UHXGRPDEJZQ6TNYPEKZEN9YP6X7Z3RYPJXJUM5WF5KYAT5V5SXZMT0DENJQCM0WD5KWMN9WFES5GC2FESK6EF6YPXH2MR5D9EKJEEQ2ESH2MR5PFGX7MRFVDUN5GPJYPHKVGPJPFZX2UNFWESHG6T0DCAZQMF0XSUZWTESYUHNQFE0XGNS53N0WFKKZAP6YPGRY46NFQ9Q53PNXAZ5Z3PC8QAZQKNSW43RWDRFDFCXV6Z92F9YU6NGGD94S5NNWP2XGNZ22C6K2M69D4F4YKNYFPC5GANS',
      'UR:BYTES/2OF2/J8RX04F2WJ9SSY577U30R55ELM4LUCJCXJVJTD60SYV9A286Q0AQH7QXL6/8944VARY2EZHJ62CDVMHQKRC2F3XVKN629M8X3ZXWPNYGJZ9FPT8G4NS0Q6YG73EG3R42468DCE9S6E40FRN2AF5X4G4GNTNT9FNYAN2DA5YU5G2PGCNVWZYGSMRQVE6YPD8QATZXU6K6S298PZK57TC2DAX772SD4RKUEP4G5MY672YXAQ5C36WDEJ8YA2HWC6NY7RS0F5K6KJ3FD6KKAMKG4N9S4ZGW9K5SWRWVF3XXDNRVDGR2APJV9XNXMTHWVEHQJ6E2DHYKUZTF4XHJARYVF8Y2KJX24UYK7N6W3V5VNFC2PHQ5ZSJDYL5T',
    ];

    await waitFor(element(by.id('UrProgressBar'))).toBeNotVisible();

    for (const ur of urs) {
      await scanText(ur);
      await waitFor(element(by.id('UrProgressBar'))).toBeVisible();
    }

    await waitForText('OK', 3 * 61000); // waiting for wallet import
    await element(by.text('OK')).tap();
    await scrollUpOnHomeScreen();
    // ok, wallet imported

    // lets go inside wallet
    const expectedWalletLabel = 'Multisig Vault';
    await element(by.text(expectedWalletLabel)).tap();

    // sending...

    await waitForId('SendButton');
    await element(by.id('SendButton')).tap();

    await waitForId('AddressInput');
    await element(by.id('AddressInput')).replaceText('bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl');
    await element(by.id('BitcoinAmountInput')).replaceText('0.0005');
    await element(by.id('BitcoinAmountInput')).tapReturnKey();
    await waitForKeyboardToClose();

    // setting fee rate:
    const feeRate = 3;
    await setCustomFeeRate(feeRate);

    await element(by.id('CreateTransactionButton')).tap();

    await waitFor(element(by.id('ItemUnsigned'))).toBeVisible();
    await waitFor(element(by.id('ItemSigned'))).toBeNotVisible(); // not a single green checkmark

    await waitForId('ProvideSignature');
    await element(by.id('ProvideSignature')).tap();
    await waitFor(element(by.id('CosignedScanOrImportFile')))
      .toBeVisible()
      .whileElement(by.id('PsbtMultisigQRCodeScrollView'))
      .scroll(500, 'down'); // in case emu screen is small and it doesnt fit

    await tapAndTapAgainIfElementIsNotVisible('CosignedScanOrImportFile', 'ScanQrBackdoorButton');

    const ursSignedByPassport = [
      'UR:CRYPTO-PSBT/22-4/LPCMAACFAXPLCYZTVYVOPKHDWPHKAXPYJOIHIDHNJSATRTSWEYGUHDURWYDECAGLAAHTTBHTFZFPWDRTLROXLUEHCXAHJTIHTEHDHKTEVTOTIOWFSKGEOSCFFLDRGLFTCYKELSRDNSHYGLLEVYIDGYZOEEDAAOENHGASFDHFVWNSATVYCFETATZSFROXFPMHGUJNWDSPNYMHHGPAIMGYURAYCXLEZEZSCLKBJZLFSRAOOYMSYNCEHDOSPYGTTDSODRSKLALBCAVYBNOLOEGSOYVOVLMWFDPFHGBAVDAEAEAEADADWMDTGDPTADAEADADSTENFYASFDTBCLDINBAOHFHYTPPKWYMSSNDKHKKNUOIELPDRKTOYHPCFCSWNFXPKFZNEPKVOIOCNAOAXMNPSKPLTGYFLRHLOHGUYKISWBWVEGUGMLAAYDLLDLSAAVDTDSADLIDFXYLKKFYURMTOXLKMDRSTYTERSJNHSBDPSGOGWJKJESTWLZCTKGE',
      'UR:CRYPTO-PSBT/52-4/LPCSEEAACFAXPLCYZTVYVOPKHDWPPECPWPHNLBGMLDGOMWJYMDASCFYTOEGRTDGMZOCXFGFEGOSPBDSBISPKCNNYNBIORDRLRTRTHGAAHLGDFWJTVWCEYKGLVEIODSYKKNMSBGNYSAZEZEADGHSAAEAEAECPAMAXCSPLEHGDWFSAGETNWLPRECKOSKDWURMKMYSOASBEBDBNLBFMESCHZEVSJTJKDNADCEENTDROWFVYWEPDRNMDSNYKPMRYZMRLMNRYPAAYBKTDCLGDJKIYBNTYFXECMKWFLSWFWPCPGYBKEHSETTOECANTRHKGFGCLSROLMYLKNSOLHGGDHPOXWPMWCKLYETCLMWAMIDISHKKPJTWDHFPTECMOBALNDABSPTAXAEAELAAEADAEAELSAOGDPTAEAHFLGMCLAXDWPLAHBSMTLSHFPKRLMTIYLRYATNLGPLWFLYHFTOTLRDWZHKBWLAHNFNCPWTIMRFLUVYHLBWKBCXGYNLFYDPOL',
      'UR:CRYPTO-PSBT/76-4/LPCSGSAACFAXPLCYZTVYVOPKHDWPBKEHRTTTFDCTNTRHKGFGCXSAHSRHWDMDTONBRLROWMSFCPBTHNTIAAGMPLAEAECPAOAXFXPSGMTABNWEIAJTHSCLAOSERKVLJKADWEBKTBBTRKJPTPYKMKLTMSRYRKDYPLLKCECMLGTBAXDYAEAELAAEAEAELAAEAEAELAAOAEAELAADAEAEAEAEAEAEAECPAOAXCSMYGWCMSGFWBTIENEOTRHHDFTVTLYTASNUYWZAMFSNLZSYLHGDKDWAYKBFYZTECCETEKBPMLODYAEAELAAEAEAELAAEAEAELAAOAEAELAADAEAEAEAEAEAEAEADADFLGMCLAXCSMYGWCMSGFWBTIENEOTRHHDFTVTLYTASNUYWZAMFSNLZSYLHGDKDWAYKBFYZTECCLAXFXPSGMTABNWEIAJTHSCLAOSERKVLJKADWEBKTBBTRKJPTPYKMKLTMSRYRKDYPLLKGMPLAEAEAEWLCMNTPF',
      'UR:CRYPTO-PSBT/416-4/LPCFADNBAACFAXPLCYZTVYVOPKHDWPONBWDWPACLGTAEIDWLWZBAZODNCSMSEHZELBIYDLMWCSHDIADKNYWNZSSGPKVEFLMKLRKNCELEDAMYEMBYKIJKFNDEDMIAHPLBRDPMLTROWMFNWSLTROCMIOYKWPFZDSLGLGDKWSOYPFAHMODAMYENSAIOSEGAZEEHTSLBKGOEDMWZUTRFNYJEKIPEEMIYJSOTUEZERORFPSGRPABSSKLOGOONAECAGRSFBDLRWFEMLNSALRCWZOWNLPHNPTNSLPJTKBMTEYNSISTAFTEHSEGDOTENSNMHKNFGCLFXOXMYPLCELTKOMTNEGRTOJYGURHKGPMTAFHHKWPKIOTJPGWVSKNSKSSFTOYPTKKSGSRFGIORHMDDAFHNYKTHPCPOTKEGELANNLEWEGMJEKPIYGYSFECJNCWFNRYVLTBTBWPHTKBISTLRLDEMWADCWMNKTTARKDRJSZCJPLRCNFSHGNEGAMTYLVLGOWS',
    ];

    for (const ur of ursSignedByPassport) {
      await scanText(ur);
      await waitFor(element(by.id('UrProgressBar'))).toBeVisible();
    }

    await waitFor(element(by.id('ItemSigned'))).toBeVisible(); // one green checkmark visible

    await element(by.id('ProvideSignature')).tap();
    await waitFor(element(by.id('CosignedScanOrImportFile')))
      .toBeVisible()
      .whileElement(by.id('PsbtMultisigQRCodeScrollView'))
      .scroll(500, 'down'); // in case emu screen is small and it doesnt fit
    await tapAndTapAgainIfElementIsNotVisible('CosignedScanOrImportFile', 'ScanQrBackdoorButton');

    const urSignedByPassportAndKeystone = [
      'UR:CRYPTO-PSBT/105-2/LPCSINAOCFAXOLCYSBLUFDHSHKADTEHKAXOTJOJKIDJYZMADAEKIAOAEAEAEADSGMHIEQDIAFLKPVABAJEHLLNVLRKKPCPDAHYNSOTTSOYBTIMMUCYAASSMDAMDAMKAEAEAEAEAEZMZMZMZMAOGDSRAEAEAEAEAEAECMAEBBKBOTLPWFGMRNINIMPFYNWLGEBAVTVLSWTYPAGEGUWFVLAEAEAEAEAEAECPAECXHEJTWTTTWEPDFMMDSNYKDPRYZMRLBARSPAAYLETDCLGDJKIHBNTYFXCHNNWTRHFEAEAEAEAEAEADAEWDAOAEAEAEAEADADSTENIYASISYLVDVLGWCXRPBWVYVSDALOTLCESKTTFEJTWDTBPTECMOMNLNDABSDTADAEAEAEAEADAEAELAAOGDPTADAEAEAEAEAECPAECXCLSWSSWSCPVTGTESFWSBCTCSETNSPYNLBKJLZTUEMWSOMSNNTYGSLSFPNEPKVOIOONMOAOAEAEAEAEAECMAEBBMNAMRTRKDYGUHDURWSVOLGDRRLESMEDLOLGWLYNTAOFLDYFYAOCXDYYTJOMYYAUELEDYKIYLADUROYFNURDRGLFTCYKEKEFEIAOYGSTNCPIDGYZOEEDAAOCXHGCAENYKHNJLGOHEJOGMRLBNTDWYGWJOPFPYFMKKTISROXGMIMGYURAYCXLEUOZSADCLAOJPBGWSASPTIATTPMLECMPRIHSTMDJYLOYKTKRTHHTLSTFZKPOYWKBKROASBGBAVDAEAEAEAEADADDNGDPTADAEAEAEAEAECPAECXCLSWSSWSCPVTGTESFWSBCTCSETNSPYNLBKJLZTUEMWSOMSNNTYGSLSFPNEPKVOIOCPAOAXFTRPWPCPGYBKEHRTTTFDCTNTRHKGFGCXSAHSRHWDMDTONBRLROWMSFCPBTHNTIAAFLDYFYAOCXISRERKHDRDGAPMATEHJLFL',
      'UR:CRYPTO-PSBT/158-2/LPCSNNAOCFAXOLCYSBLUFDHSHKADTEZECFFTHDETNBADMOCLINLNOSOXZEYKGDPYTPKTRETNURTIZOPDAOCXIAAOWETTJKMDUOSBONAASWNLMERLZSGLCYCTGAKBDAFHGHWKMTRSNLAAYKFWWPRSADADAHFLGMCLAXBAPLDADMGDFLRHLOHGUYHESWEOSKMDMTJLDRTKSSRDFGDWSNTNCHZEVSJTJKDNCNCLAXFTRPWPCPGYBKEHRTTTFDCTNTRHKGFGCXSAHSRHWDMDTONBRLROWMSFCPBTHNTIAAGMPLCPAMAXBAPLDADMGDFLRHLOHGUYHESWEOSKMDMTJLDRTKSSRDFGDWSNTNCHZEVSJTJKDNCNCECMLGTBAXDYAEAELAAEAEAELAAEAEAELAAOAEAELAAEAEAEAEAXAEAEAECPAMAXFTRPWPCPGYBKEHRTTTFDCTNTRHKGFGCXSAHSRHWDMDTONBRLROWMSFCPBTHNTIAACETEKBPMLODYAEAELAAEAEAELAAEAEAELAAOAEAELAAEAEAEAEAXAEAEAEAEAEADADFLGMCLAXCSMYGWCMSGFWBTIENEOTRHHDFTVTLYTASNUYWZAMFSNLZSYLHGDKDWAYKBFYZTECCLAXFXPSGMTABNWEIAJTHSCLAOSERKVLJKADWEBKTBBTRKJPTPYKMKLTMSRYRKDYPLLKGMPLCPAOAXCSMYGWCMSGFWBTIENEOTRHHDFTVTLYTASNUYWZAMFSNLZSYLHGDKDWAYKBFYZTECCETEKBPMLODYAEAELAAEAEAELAAEAEAELAAOAEAELAADAEAEAEAEAEAEAECPAOAXFXPSGMTABNWEIAJTHSCLAOSERKVLJKADWEBKTBBTRKJPTPYKMKLTMSRYRKDYPLLKCECMLGTBAXDYAEAELAAEAEAELAAEAEAELAAOAEAELAADAEAEAEAEAEAEAEAENNHKLKUO',
    ];

    for (const ur of urSignedByPassportAndKeystone) {
      await scanText(ur);
      await waitFor(element(by.id('UrProgressBar'))).toBeVisible();
    }

    await waitFor(element(by.id('ExportSignedPsbt'))).toBeVisible();

    await element(by.id('PsbtMultisigConfirmButton')).tap();

    // created. verifying:
    await waitForId('TransactionValue');
    await expect(element(by.id('TransactionValue'))).toHaveText('0.0005');
    await element(by.id('TransactionDetailsButton')).tap();

    const txhex = await extractTextFromElementById('TxhexInput');

    const transaction = bitcoin.Transaction.fromHex(txhex);
    assert.ok(transaction.ins.length === 1);
    assert.strictEqual(transaction.outs.length, 2);
    assert.strictEqual(bitcoin.address.fromOutputScript(transaction.outs[0].script), 'bc1q063ctu6jhe5k4v8ka99qac8rcm2tzjjnuktyrl'); // to address
    assert.strictEqual(transaction.outs[0].value, 50000n);

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  // eslint-disable-next-line jest/no-disabled-tests -- Deferred: alternate account discovery is outside the fixed XBT BIP84 profile.
  it.skip('can discover wallet account and import it', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t7');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t6'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right'); // in case emu screen is small and it doesnt fit
    // going to Import Wallet screen and importing mnemonic
    await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ScrollView');
    await waitFor(element(by.id('ImportWallet')))
      .toBeVisible()
      .whileElement(by.id('ScrollView'))
      .scroll(500, 'down'); // in case emu screen is small and it doesnt fit
    await element(by.id('ImportWallet')).tap();
    await element(by.id('MnemonicInput')).typeText('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong');
    await tapIfTextPresent('Done');
    await element(by.id('HeaderMenuButton')).tap();
    await expect(element(by.text('Search accounts'))).toBeVisible();
    await element(by.text('Passphrase')).tap();
    await element(by.id('DoImport')).tap();

    // cancel import and start over
    await waitFor(element(by.text('Cancel')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.text('Cancel')).tap();
    await element(by.id('DoImport')).tap();
    await waitFor(element(by.text('OK')))
      .toBeVisible()
      .withTimeout(10000);
    await element(by.text('OK')).tap();

    // wait for discovery to be completed
    await waitFor(element(by.text("m/84'/0'/0'")))
      .toBeVisible()
      .withTimeout(300 * 1000);
    await expect(element(by.text("m/44'/0'/0'"))).toBeVisible();
    await expect(element(by.id('Loading'))).not.toBeVisible();

    // open custom derivation path screen and import the wallet
    await element(by.id('CustomDerivationPathButton')).tap();
    await element(by.id('DerivationPathInput')).clearText();
    await element(by.id('DerivationPathInput')).typeText("m/44'/0'/0'\n");
    await waitForKeyboardToClose();
    await waitFor(element(by.text('Found'))) // wait for discovery to be completed
      .toExist()
      .withTimeout(300 * 1000);
    await element(by.text('Found')).tap();
    await element(by.id('ImportButton')).tap();
    await element(by.text('OK')).tap();

    // go to wallet and check derivation path
    await element(by.id('Imported HD Legacy (BIP44 P2PKH)')).tap();
    await element(by.id('WalletDetails')).tap();
    await waitFor(element(by.text('Advanced')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.text('Advanced')).tap();
    await waitFor(element(by.text("m/44'/0'/0'")))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(100, 'down');
    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  it('can create wallet, and use main screen SCAN button to scan address', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t8');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t8'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'YES', camera: 'YES' } }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();

    await helperCreateWallet();
    // Wait for the home screen's floating actions to mount after wallet creation.
    await waitForId('HomeScreenScanButton');
    await tapAndTapAgainIfElementIsNotVisible('HomeScreenScanButton', 'ScanQrBackdoorButton');
    await scanText('bitcoin:bc1qzrtn3xwlunlrm0n0uu23lr00gmdx4lnlavdy75');
    await waitForId('AddressInput');
    await expect(element(by.id('AddressInput'))).toHaveText('bc1qzrtn3xwlunlrm0n0uu23lr00gmdx4lnlavdy75');

    // Lightning and Azteco routing are outside this XBT release; retain the onchain scan assertions above.

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  it('can create wallet and delete wallet', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t9');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t8'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true }); // reinstalling the app just for any case to clean up app's storage
    await waitForWalletsList();
    await helperCreateWallet();
    // nop
    await helperDeleteWallet('cr34t3d');
    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  // eslint-disable-next-line jest/no-disabled-tests -- Deferred: multisig is outside the XBT BIP84 release.
  it.skip('can create 2of3 multisig vault with generated keys, manage cosigners and export coordination setup; forgetting seed/restoring seed does not change receive address', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t10');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t10'), 'as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { camera: 'YES', notifications: 'YES' } });
    await waitForWalletsList();
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right');

    // navigate to vault creation (default 2-of-3 native segwit)
    await element(by.id('CreateAWallet')).tap();
    await waitForId('ActivateVaultButton');
    await element(by.id('ActivateVaultButton')).tap();
    await element(by.id('Create')).tap();
    // skip advanced settings, use defaults (2-of-3, native segwit)
    await element(by.id('LetsStart')).tap();

    // key 1 - generate new
    await waitForId('VaultKeyGenerate');
    await element(by.id('VaultKeyGenerate')).tap();
    await waitForId('VaultKeyDone');
    await element(by.id('VaultKeyDone')).tap();

    // key 2 - generate new
    await waitForId('VaultKeyGenerate');
    await element(by.id('VaultKeyGenerate')).tap();
    await waitForId('VaultKeyDone');
    await element(by.id('VaultKeyDone')).tap();

    // key 3 - import seed via scan
    await waitForId('VaultCosignerImport3');
    await element(by.id('VaultCosignerImport3')).tap();
    await waitForId('ScanOrOpenFile');
    await element(by.id('ScanOrOpenFile')).tap();
    await scanText('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    // create vault
    await waitForId('CreateButton');
    await element(by.id('CreateButton')).tap();
    await waitForText('OK', 3 * 61000);
    await tapIfTextPresent('OK');

    // navigate into wallet
    await scrollUpOnHomeScreen();
    await waitForId('Multisig Vault');
    await element(by.id('Multisig Vault')).tap();
    await waitForId('ReceiveButton');

    // verify wallet details
    await element(by.id('WalletDetails')).tap();
    await waitFor(element(by.text('Advanced')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.text('Advanced')).tap();
    await waitFor(element(by.text('2 / 3 (native segwit)')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(100, 'down');

    // test Export Coordination Setup, it has animated qrcode, that uses setInterval, so we need to disable synchronization
    await waitFor(element(by.id('MultisigCoordinationSetup')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    // Tap high in the row: full-width list hitboxes near the bottom edge can extend into the system nav bar on Android.
    await element(by.id('MultisigCoordinationSetup')).tap({ x: 120, y: 18 });
    await device.disableSynchronization();
    await waitForId('ExportMultisigCoordinationSetupView');
    await element(by.id('NavigationCloseButton')).atIndex(0).tap();
    await device.enableSynchronization();

    // go to receive screen and capture current receive address
    await goBack();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('AddressValue');
    const vaultReceiveAddress = await extractTextFromElementById('AddressValue');
    assert.ok(vaultReceiveAddress && vaultReceiveAddress.length > 20);
    await goBack();
    await waitForId('ReceiveButton');
    await element(by.id('WalletDetails')).tap();
    await waitFor(element(by.id('WalletDetailsScroll')))
      .toBeVisible()
      .withTimeout(20000);

    console.log('vaultReceiveAddress', vaultReceiveAddress);

    // test View/Edit Cosigners
    await waitFor(element(by.id('ViewEditCosigners')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(100, 'down');
    // Extra scroll moves the full-width row up so its hitbox no longer overlaps the Android system nav bar.
    await element(by.id('WalletDetailsScroll')).scroll(200, 'down');
    await element(by.id('ViewEditCosigners')).tap();
    await waitForText('Vault Key 1');
    await expect(element(by.text('Vault Key 2'))).toBeVisible();
    await waitFor(element(by.text('Vault Key 3')))
      .toBeVisible()
      .whileElement(by.id('ViewEditMultisigCosignersFlatList'))
      .scroll(100, 'down');

    // forget seed for cosigner 3 (replaces seed with xpub)
    await waitFor(element(by.id('VaultCosignerForgetSeed3')))
      .toBeVisible()
      .whileElement(by.id('ViewEditMultisigCosignersFlatList'))
      .scroll(100, 'down');
    await element(by.id('VaultCosignerForgetSeed3')).tap();
    // after forget, "I have mnemonics" button should appear for this cosigner
    await waitFor(element(by.id('VaultCosignerImportMnemonics3')))
      .toBeVisible()
      .whileElement(by.id('ViewEditMultisigCosignersFlatList'))
      .scroll(100, 'down');

    // save changes
    await waitFor(element(by.id('VaultCosignersSave')))
      .toBeVisible()
      .withTimeout(33000);
    await element(by.id('VaultCosignersSave')).tap();
    await waitForWalletsList();

    // verify receive address remains unchanged after forgetting cosigner 3 seed
    await scrollUpOnHomeScreen();
    await waitForId('Multisig Vault');
    await element(by.id('Multisig Vault')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await element(by.text('Yes, I have.')).tap();
    await waitForId('AddressValue');
    const vaultReceiveAddressAfterCosignerSave = await extractTextFromElementById('AddressValue');
    assert.strictEqual(vaultReceiveAddressAfterCosignerSave, vaultReceiveAddress);

    // go back to manage keys, restore seed for cosigner 3, and save
    await goBack();
    await waitForId('ReceiveButton');
    await element(by.id('WalletDetails')).tap();
    await waitFor(element(by.id('WalletDetailsScroll')))
      .toBeVisible()
      .withTimeout(20000);
    await waitFor(element(by.id('ViewEditCosigners')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(100, 'down');
    // Extra scroll moves the full-width row up so its hitbox no longer overlaps the Android system nav bar.
    await element(by.id('WalletDetailsScroll')).scroll(200, 'down');
    await element(by.id('ViewEditCosigners')).tap();
    await waitFor(element(by.id('VaultCosignerImportMnemonics3')))
      .toBeVisible()
      .whileElement(by.id('ViewEditMultisigCosignersFlatList'))
      .scroll(100, 'down');
    await element(by.id('VaultCosignerImportMnemonics3')).tap();
    await waitForId('MnemonicInputSheet');
    await element(by.id('MnemonicInputSheet')).replaceText(
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    );
    await element(by.id('DoImportKeyButton')).tap();
    await waitFor(element(by.id('VaultCosignersSave')))
      .toBeVisible()
      .withTimeout(33000);
    await element(by.id('VaultCosignersSave')).tap();
    await waitForWalletsList();

    // verify receive address remains unchanged after restoring cosigner 3 seed
    await scrollUpOnHomeScreen();
    await waitForId('Multisig Vault');
    await element(by.id('Multisig Vault')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await element(by.text('Yes, I have.')).tap();
    await waitForId('AddressValue');
    const vaultReceiveAddressAfterCosignerRestore = await extractTextFromElementById('AddressValue');
    assert.strictEqual(vaultReceiveAddressAfterCosignerRestore, vaultReceiveAddress);

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });

  // eslint-disable-next-line jest/no-disabled-tests -- Deferred: wrapped multisig is outside the XBT BIP84 release.
  it.skip('can create wrapped segwit 2of2 vault via advanced settings', async () => {
    const lockFile = '/tmp/travislock.' + hashIt('t11');
    if (process.env.CI) {
      if (require('fs').existsSync(lockFile)) return console.warn('skipping', JSON.stringify('t11'), ' as it previously passed on Travis');
    }
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { camera: 'YES', notifications: 'YES' } });
    await waitForWalletsList();
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right');

    // navigate to vault creation
    await element(by.id('CreateAWallet')).tap();
    await waitForId('ActivateVaultButton');
    await element(by.id('ActivateVaultButton')).tap();
    await element(by.id('Create')).tap();

    // open advanced settings: change to wrapped segwit, 2-of-2
    await element(by.id('VaultAdvancedCustomize')).tap();
    await element(by.id('DecreaseN')).tap(); // 3 → 2
    await element(by.text('Best compatibility (p2sh-p2wsh)')).tap();
    await element(by.id('ModalDoneButton')).tap();

    await element(by.id('LetsStart')).tap();

    // key 1 - import seed
    await element(by.id('VaultCosignerImport1')).tap();
    await waitForId('ScanOrOpenFile');
    await element(by.id('ScanOrOpenFile')).tap();
    await scanText('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    // key 2 - import seed
    await waitForId('VaultCosignerImport2');
    await element(by.id('VaultCosignerImport2')).tap();
    await waitForId('ScanOrOpenFile');
    await element(by.id('ScanOrOpenFile')).tap();
    await scanText('zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong');

    // create vault
    await waitForId('CreateButton');
    await element(by.id('CreateButton')).tap();
    await waitForText('OK', 3 * 61000);
    await tapIfTextPresent('OK');

    // navigate into wallet and verify format
    await scrollUpOnHomeScreen();
    await waitForId('Multisig Vault');
    await element(by.id('Multisig Vault')).tap();
    await waitForId('ReceiveButton');
    await element(by.id('WalletDetails')).tap();
    await waitFor(element(by.text('Advanced')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    await element(by.text('Advanced')).tap();
    await waitFor(element(by.text('2 / 2 (wrapped segwit)')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(100, 'down');

    process.env.CI && require('fs').writeFileSync(lockFile, '1');
  });
});
