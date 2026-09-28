import { element, waitFor } from 'detox';

import { helperCreateWallet, waitForId, waitForKeyboardToClose, tapAndTapAgainIfElementIsNotVisible } from './helperz';

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
});
