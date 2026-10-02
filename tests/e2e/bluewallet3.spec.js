import { dismissAlertByText, enterMnemonicText, getSwitchValue, goBack, scrollUpOnHomeScreen, waitForId, waitForText } from './helperz';
const assert = require('assert').strict;

describe('RedWallet XBT watch-only import', () => {
  it('imports a BIP84 public account with external signing disabled', async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'NO', camera: 'YES' } });
    await waitForId('WalletsList', 120_000);
    await element(by.id('SettingsButton')).tap();
    await element(by.id('NetworkSettings')).tap();
    await element(by.id('ElectrumSettings')).tap();
    await waitForId('ElectrumConnectionEnabledSwitch');
    if (!(await getSwitchValue('ElectrumConnectionEnabledSwitch'))) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
    await goBack();
    await goBack();
    await goBack();
    await waitForId('CreateAWallet');
    await element(by.id('CreateAWallet')).tap();
    await waitForId('ImportWallet');
    await element(by.id('ImportWallet')).tap();
    await waitForId('MnemonicInput');
    await enterMnemonicText(
      'zpub6s2EvLxwvDpaHNVP5vfordTyi8cH1fR8usmEjz7RsSQjfTTGU2qA5VEcEyYYBxpZAyBarJoTraB4VRJKVz97Au9jRNYfLAeeHC5UnRZbz8Y',
    );
    const isIOS = device.getPlatform() === 'ios';
    if (isIOS) await device.disableSynchronization();
    try {
      await element(by.id('DoImport')).tap();
      await waitForText('Your wallet has been successfully imported. WARNING: This is a watch-only wallet, you can NOT spend from it.');
      if (!(await dismissAlertByText('OK'))) throw new Error('Could not dismiss watch-only import confirmation');
    } finally {
      if (isIOS) await device.enableSynchronization();
    }
    await scrollUpOnHomeScreen();
    await waitForId('Imported Watch-only', 60_000);
    await element(by.id('Imported Watch-only')).tap();
    await waitForId('WalletDetails');
    await element(by.id('WalletDetails')).tap();
    await waitFor(element(by.id('XbtExternalSignerSwitch')))
      .toBeVisible()
      .whileElement(by.id('WalletDetailsScroll'))
      .scroll(150, 'down');
    assert.equal(await getSwitchValue('XbtExternalSignerSwitch'), false);
  });
});
