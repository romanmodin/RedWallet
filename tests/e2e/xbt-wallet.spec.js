import { element, waitFor } from 'detox';

import {
  dismissAlertByText,
  helperCreateWallet,
  scrollUpOnHomeScreen,
  waitForId,
  waitForKeyboardToClose,
  waitForLabel,
  waitForText,
  tapAndTapAgainIfElementIsNotVisible,
} from './helperz';

/** UI smoke coverage for the features included in the first XBT release. */
describe('RedWallet XBT-only release UI', () => {
  beforeEach(async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true });
    await waitForId('WalletsList');
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
    await waitForId('WalletsList');
    await tapAndTapAgainIfElementIsNotVisible('xbt-created', 'ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await element(by.text('Yes, I have.')).tap();
    await waitForId('BitcoinAddressQRCode');
    await waitForId('CopyTextToClipboard');
    await element(by.id('SetCustomAmountButton')).tap();
    await element(by.id('BitcoinAmountInput')).replaceText('1');
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
    await element(by.id('MnemonicInput')).replaceText(mnemonic);
    await element(by.id('DoImport')).tap();
    await waitForText('Your wallet has been successfully imported.');
    if (!(await dismissAlertByText('OK'))) throw new Error('Could not dismiss successful recovery confirmation');
    await waitForId('WalletsList');
    await scrollUpOnHomeScreen();
    await waitForId(walletLabel);
    await tapAndTapAgainIfElementIsNotVisible(walletLabel, 'ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('BitcoinAddressQRCode');
    await waitForLabel(expectedAddress);

    await device.launchApp({ newInstance: true });
    await waitForId('WalletsList');
    await waitForId(walletLabel);
    await tapAndTapAgainIfElementIsNotVisible(walletLabel, 'ReceiveButton');
    await element(by.id('ReceiveButton')).tap();
    await waitForId('BitcoinAddressQRCode');
    await waitForLabel(expectedAddress);
  });
});
