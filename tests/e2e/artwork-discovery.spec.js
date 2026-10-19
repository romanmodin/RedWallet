import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { element, waitFor } from 'detox';
import { getSwitchValue, goBack, helperCreateWallet, scrollUpOnHomeScreen, waitForId, waitForWalletsList } from './helperz';

const smoke = process.env.REDWALLET_VISUAL_SMOKE === '1' ? describe : describe.skip;
const capture = async name => {
  const file = await device.takeScreenshot(name);
  const directory = path.resolve('artifacts/appearance-discovery');
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(file, path.join(directory, name + '.png'));
};
smoke('Native artwork framing and read-only CoinJoin discovery', () => {
  it('centers artwork on an empty wallet and completes a real pool search without joining', async () => {
    await device.clearKeychain();
    // Detox 20 has no setAppearance API. Set the selected disposable simulator
    // through Apple's native command before launching the app.
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'dark']);
    await device.launchApp({ delete: true, permissions: { notifications: 'NO' } });
    await waitForWalletsList();
    await element(by.id('SettingsButton')).tap();
    await element(by.id('NetworkSettings')).tap();
    await element(by.id('ElectrumSettings')).tap();
    await waitForId('ElectrumConnectionEnabledSwitch');
    if (!(await getSwitchValue('ElectrumConnectionEnabledSwitch'))) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
    await goBack();
    await goBack();
    await goBack();
    await helperCreateWallet('Artwork Test Wallet', 'taproot');
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
    await capture('01-helmet-portrait');
    await device.setOrientation('landscape');
    await capture('02-helmet-landscape');
    await device.setOrientation('portrait');
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('Tools')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(300, 'down');
    await element(by.id('Tools')).tap();
    await element(by.id('CoinjoinExperimental')).tap();
    await element(by.id('CoinjoinOptIn')).tap();
    await device.disableSynchronization();
    try {
      await waitFor(element(by.id('CoinjoinFindPools')))
        .toBeVisible()
        .whileElement(by.id('CoinjoinLiveScreen'))
        .scroll(250, 'down');
      await element(by.id('CoinjoinFindPools')).tap();
      const deadline = Date.now() + 35000;
      let status = '';
      while (Date.now() < deadline) {
        const attrs = await element(by.id('CoinjoinPoolSearchStatus')).getAttributes();
        status = attrs.label || attrs.text || '';
        if (status.includes('Listening for updates.') || status.includes('Connected. No compatible open pools')) break;
        if (status.includes('failed or disconnected')) throw new Error(status);
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!status.includes('Listening for updates.') && !status.includes('Connected. No compatible open pools'))
        throw new Error('Pool search never completed: ' + status);
      await capture('03-pool-discovery');
      console.log('Native read-only pool discovery:', status);
    } finally {
      await device.enableSynchronization();
      execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
    }
  });
});
