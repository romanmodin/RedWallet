import fs from 'node:fs';
import path from 'node:path';
import { element, waitFor } from 'detox';
import {
  dismissAlertByText,
  getSwitchValue,
  goBack,
  helperCreateWallet,
  scrollUpOnHomeScreen,
  tapAndTapAgainIfElementIsNotVisible,
  waitForId,
  waitForWalletsList,
} from './helperz';

// Capture-only workflow. No funded wallet, synthetic balance, seeded private
// account, or production service is involved. Never capture the backup screen.
const captureSuite = process.env.REDWALLET_STORE_SCREENSHOTS === '1' ? describe : describe.skip;
const capture = async name => {
  const file = await device.takeScreenshot(name);
  const directory = path.resolve('artifacts/app-store');
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(file, path.join(directory, name + '.png'));
};

captureSuite('App Store screenshots from the pinned native iOS app', () => {
  it('captures wallet, receive, recovery controls and optional artwork', async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'NO' } });
    await waitForWalletsList();
    await element(by.id('SettingsButton')).tap();
    await element(by.id('NetworkSettings')).tap();
    await element(by.id('ElectrumSettings')).tap();
    await waitForId('ElectrumConnectionEnabledSwitch');
    if (!(await getSwitchValue('ElectrumConnectionEnabledSwitch'))) {
      await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
    }
    await goBack();
    await goBack();
    await goBack();

    await helperCreateWallet('Demo Taproot Wallet', 'taproot');
    await device.launchApp({ newInstance: true });
    await waitForWalletsList();
    await scrollUpOnHomeScreen();
    await waitForId('Demo Taproot Wallet');
    await capture('01-wallet');

    await tapAndTapAgainIfElementIsNotVisible('Demo Taproot Wallet', 'ReceiveButton');
    await device.disableSynchronization();
    try {
      await element(by.id('ReceiveButton')).tap();
      if (!(await dismissAlertByText('Yes, I have.'))) throw new Error('Demo backup confirmation was not displayed');
      await device.disableSynchronization();
      await waitForId('BitcoinAddressQRCode');
      await capture('02-receive');
    } finally {
      await device.enableSynchronization();
    }

    await device.launchApp({ newInstance: true });
    await waitForWalletsList();
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(300, 'down');
    await element(by.id('ArtworkSkinLogo')).multiTap(2);
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toHaveLabel('Artwork skin enabled')
      .withTimeout(5000);
    await goBack();
    await waitForWalletsList();
    await scrollUpOnHomeScreen();
    await capture('03-optional-artwork');

    // The add-wallet card is to the right of the demo wallet on iPhone.
    // Bring it fully into view before tapping, as the import helper does.
    await waitFor(element(by.id('CreateAWallet')))
      .toBeVisible()
      .whileElement(by.id('WalletsList'))
      .scroll(500, 'right');
    await tapAndTapAgainIfElementIsNotVisible('CreateAWallet', 'ImportWallet');
    await element(by.id('ImportWallet')).tap();
    await waitForId('MnemonicInput');
    await element(by.id('ToggleRecoveryDiscovery')).tap();
    await waitForId('RecoveryGapLimit');
    // Empty recovery field: no recovery phrase or private key is captured.
    await capture('04-recovery-options');
  });
});
