import { element, waitFor } from 'detox';

import {
  dismissAlertByText,
  enterMnemonicText,
  getSwitchValue,
  goBack,
  waitForSwitchValue,
  helperCreateWallet,
  scrollUpOnHomeScreen,
  waitForId,
  waitForWalletsList,
  waitForKeyboardToClose,
  waitForLabel,
  waitForText,
  tapAndTapAgainIfElementIsNotVisible,
} from './helperz';

// The receive/import flows show native iOS alerts. CI observed a covered Receive
// button and an idle-wait timeout at the QR assertion; use bounded element waits
// inside these transitions while leaving normal test synchronization enabled.
async function withoutIosAlertSynchronization(action) {
  const isIOS = device.getPlatform() === 'ios';
  if (isIOS) await device.disableSynchronization();
  try {
    await action();
  } finally {
    if (isIOS) await device.enableSynchronization();
  }
}

async function openReceive(walletLabel, confirmBackup = false) {
  await tapAndTapAgainIfElementIsNotVisible(walletLabel, 'ReceiveButton');
  await withoutIosAlertSynchronization(async () => {
    await element(by.id('ReceiveButton')).tap();
    if (confirmBackup) {
      if (!(await dismissAlertByText('Yes, I have.'))) throw new Error('Could not confirm public test wallet backup');
      // dismissAlertByText restores synchronization itself.
      if (device.getPlatform() === 'ios') await device.disableSynchronization();
    }
    await waitForId('BitcoinAddressQRCode');
  });
}

/** UI smoke coverage for the features included in the first XBT release. */
describe('RedWallet XBT-only release UI', () => {
  beforeEach(async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'NO' } });
    // A fresh hosted simulator can take longer to leave the native splash screen.
    await waitForWalletsList();
    // These deterministic no-funds tests cover offline creation and recovery.
    // Network acceptance is exercised by the separate Fulcrum and Knots gates.
    await element(by.id('SettingsButton')).tap();
    await element(by.id('NetworkSettings')).tap();
    await element(by.id('ElectrumSettings')).tap();
    await waitForId('ElectrumConnectionEnabledSwitch');
    if (!(await getSwitchValue('ElectrumConnectionEnabledSwitch'))) {
      await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
    }
    await waitForSwitchValue('ElectrumConnectionEnabledSwitch', true);
    await goBack();
    await goBack();
    await goBack();
    await waitForWalletsList();
  });

  it('offers only the supported XBT wallet profile', async () => {
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right');
    await element(by.id('CreateAWallet')).tap();
    await waitForId('WalletNameInput');

    await expect(element(by.id('ActivateBitcoinButton'))).toBeVisible();
    await expect(element(by.id('ActivateVaultButton'))).not.toExist();
    await expect(element(by.id('ActivateLightningButton'))).not.toExist();
  });

  it('creates an XBT wallet and displays an XBT receive amount', async () => {
    await helperCreateWallet('xbt-created');
    await device.launchApp({ newInstance: true });
    await waitForWalletsList();
    await openReceive('xbt-created', true);
    await waitForId('CopyTextToClipboard');
    await element(by.id('SetCustomAmountButton')).tap();
    await element(by.id('BitcoinAmountInput')).replaceText('1');
    await element(by.id('changeAmountUnitButton')).tap();
    await expect(element(by.id('BitcoinAmountInput'))).toHaveText('100000000');
    await element(by.id('changeAmountUnitButton')).tap();
    await expect(element(by.id('BitcoinAmountInput'))).toHaveText('1');
    await element(by.id('CustomAmountDescription')).replaceText('XBT smoke test');
    await element(by.id('CustomAmountDescription')).tapReturnKey();
    await waitForKeyboardToClose();
    await tapAndTapAgainIfElementIsNotVisible('CustomAmountSaveButton', 'CustomAmountDescriptionText');
    await expect(element(by.id('BitcoinAmountText'))).toHaveText('1 XBT');
  });

  it('restores the published BIP84 recovery phrase and preserves its receive address after restart', async () => {
    // Public BIP84 test vector. This test never sends funds or uses a private recovery phrase.
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const expectedAddress = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
    const walletLabel = 'Imported XBT SegWit (BIP84)';

    await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ImportWallet');
    await element(by.id('ImportWallet')).tap();
    await waitForId('MnemonicInput');
    await enterMnemonicText(mnemonic);
    await withoutIosAlertSynchronization(async () => {
      await element(by.id('DoImport')).tap();
      await waitForText('Your wallet has been successfully imported.');
      if (!(await dismissAlertByText('OK'))) throw new Error('Could not dismiss successful recovery confirmation');
    });
    await waitForWalletsList();
    await scrollUpOnHomeScreen();
    await waitForId(walletLabel);
    await openReceive(walletLabel);
    await waitForLabel(expectedAddress);

    await device.launchApp({ newInstance: true });
    await waitForWalletsList();
    await waitForId(walletLabel);
    await openReceive(walletLabel);
    await waitForLabel(expectedAddress);
  });

  it('saves a manual XBT price, restores it after restart, and clears it', async () => {
    await element(by.id('SettingsButton')).tap();
    await element(by.id('XbtPriceSettings')).tap();
    await waitForId('XbtPriceScreen');
    await waitFor(element(by.id('XbtPriceInput')))
      .toBeVisible()
      .whileElement(by.id('XbtPriceScreen'))
      .scroll(250, 'down');
    await element(by.id('XbtPriceInput')).replaceText('123.45');
    await element(by.id('XbtQuoteCurrencyInput')).replaceText('USDC');
    await element(by.id('XbtQuoteCurrencyInput')).tapReturnKey();
    await waitForKeyboardToClose();
    await waitFor(element(by.id('SaveXbtPrice')))
      .toBeVisible()
      .whileElement(by.id('XbtPriceScreen'))
      .scroll(250, 'down');
    await element(by.id('SaveXbtPrice')).tap();
    await waitForId('XbtPriceStatus');
    await expect(element(by.id('XbtPriceStatus'))).toHaveText('Saved');

    await device.launchApp({ newInstance: true });
    await waitForWalletsList();
    await element(by.id('SettingsButton')).tap();
    await element(by.id('XbtPriceSettings')).tap();
    await waitForId('XbtPriceScreen');
    await waitFor(element(by.id('XbtPriceSavedQuote')))
      .toBeVisible()
      .whileElement(by.id('XbtPriceScreen'))
      .scroll(250, 'down');
    await expect(element(by.id('XbtPriceSavedQuote'))).toHaveText('1 XBT = 123.45 USDC');
    await waitFor(element(by.id('ClearXbtPrice')))
      .toBeVisible()
      .whileElement(by.id('XbtPriceScreen'))
      .scroll(250, 'up');
    await element(by.id('ClearXbtPrice')).tap();
    await waitFor(element(by.id('XbtPriceNoQuote')))
      .toBeVisible()
      .whileElement(by.id('XbtPriceScreen'))
      .scroll(250, 'down');
    await expect(element(by.id('XbtPriceSavedQuote'))).not.toExist();
  });
});
