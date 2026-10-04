import {
  dismissAlertByText,
  enterMnemonicText,
  getSwitchValue,
  goBack,
  scrollUpOnHomeScreen,
  waitForId,
  waitForWalletsList,
  waitForText,
} from './helperz';
const assert = require('assert').strict;

describe('RedWallet XBT watch-only import', () => {
  it.each([
    ['BIP84', 'zpub6s2EvLxwvDpaHNVP5vfordTyi8cH1fR8usmEjz7RsSQjfTTGU2qA5VEcEyYYBxpZAyBarJoTraB4VRJKVz97Au9jRNYfLAeeHC5UnRZbz8Y'],
    [
      'BIP86',
      'tr([73c5da0a/86h/0h/0h]xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ/0/*)',
    ],
  ])('imports a %s public account with external signing disabled', async (format, descriptor) => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'NO', camera: 'YES' } });
    await waitForWalletsList();
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
    await enterMnemonicText(descriptor);
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
    if (format === 'BIP86') {
      if (isIOS) await device.disableSynchronization();
      try {
        await element(by.id('XbtExternalSignerSwitch')).tap();
        await waitForText('Enable XBT external signing');
        if (!(await dismissAlertByText('Cancel'))) throw new Error('Could not cancel signer enrollment');
        assert.equal(await getSwitchValue('XbtExternalSignerSwitch'), false);
        await element(by.id('XbtExternalSignerSwitch')).tap();
        await waitForText('Enable XBT external signing');
        if (!(await dismissAlertByText('Yes'))) throw new Error('Could not confirm test signer enrollment');
      } finally {
        if (isIOS) await device.enableSynchronization();
      }
      assert.equal(await getSwitchValue('XbtExternalSignerSwitch'), true);
      await device.launchApp({ newInstance: true });
      await waitForWalletsList();
      await element(by.id('Imported Watch-only')).tap();
      await waitForId('WalletDetails');
      await element(by.id('WalletDetails')).tap();
      await waitFor(element(by.id('XbtExternalSignerSwitch')))
        .toBeVisible()
        .whileElement(by.id('WalletDetailsScroll'))
        .scroll(150, 'down');
      assert.equal(await getSwitchValue('XbtExternalSignerSwitch'), true);
    }
  });
});
