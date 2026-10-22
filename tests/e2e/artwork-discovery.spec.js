import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { step } from './interaction-diagnostic-journal';
import path from 'node:path';
import { element, waitFor } from 'detox';
import { nativeCaptureEvidence, matchesNativeOrientation, shouldRepeatOrientation, observeNativeRotation } from './native-capture-helper';
import { getSwitchValue, goBack, helperCreateWallet, scrollUpOnHomeScreen, waitForId, waitForWalletsList } from './helperz';

const smoke = process.env.REDWALLET_VISUAL_SMOKE === '1' ? describe : describe.skip;
const captureObserved = async (name, orientation, surfaceId = 'ArtworkSkinSurface', rotate = false) => {
  const directory = path.resolve('artifacts/appearance-discovery');
  fs.mkdirSync(directory, { recursive: true });
  const started = Date.now();
  const deadline = started + 15000;
  let orientationRequests = 0;
  if (rotate) {
    await step(`request ${orientation}`, () => device.setOrientation(orientation), Math.max(1, deadline - Date.now()));
    orientationRequests++;
  }
  let evidence;
  // simctl captures the physical framebuffer in portrait pixel coordinates even
  // when UIKit has rotated. Assert the actual native surface bounds, retain the
  // unmodified screenshot, and require human visual inspection of both views.
  do {
    const before = await step(`${name} bounds before`, () => element(by.id(surfaceId)).getAttributes(), Math.max(1, deadline - Date.now()));
    const file = await step(`${name} screenshot`, () => device.takeScreenshot(name), Math.max(1, deadline - Date.now()));
    const png = fs.readFileSync(file);
    const after = await step(`${name} bounds after`, () => element(by.id(surfaceId)).getAttributes(), Math.max(1, deadline - Date.now()));
    evidence = nativeCaptureEvidence(png, before, after, orientation);
    // Retain the last observed native state on failure as well as success.
    fs.copyFileSync(file, path.join(directory, name + '.png'));
    fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify({ surfaceId, orientationRequests, ...evidence }, null, 2) + '\n');
    if (matchesNativeOrientation(evidence)) return;
    if (shouldRepeatOrientation(evidence, Date.now() - started, orientationRequests)) {
      await step(`request ${orientation}`, () => device.setOrientation(orientation), Math.max(1, deadline - Date.now()));
      orientationRequests++;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  throw new Error(`Native ${orientation} surface never settled: ${JSON.stringify(evidence)}`);
};
// Pool discovery already controls synchronization itself. Scope this change
// strictly to the two actual orientation transitions; every native/pixel/hash
// assertion and the original 15-second budget remain in captureObserved.
const capture = (name, orientation, surfaceId = 'ArtworkSkinSurface', rotate = false) => {
  const observation = () => captureObserved(name, orientation, surfaceId, rotate);
  return rotate
    ? observeNativeRotation(
        {
          disableSynchronization: () => step(`${name} disable synchronization`, () => device.disableSynchronization()),
          enableSynchronization: () => step(`${name} restore synchronization`, () => device.enableSynchronization()),
        },
        observation,
      )
    : observation();
};
smoke('Native artwork framing and read-only CoinJoin discovery', () => {
  it('centers artwork on an empty wallet and completes a real pool search without joining', async () => {
    await step('clear disposable keychain', () => device.clearKeychain(), 60000);
    // Detox 20 has no setAppearance API. Set the selected disposable simulator
    // through Apple's native command before launching the app.
    execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'dark']);
    await device.launchApp({
      delete: true,
      permissions: { notifications: 'NO' },
    });
    await waitForWalletsList();
    await element(by.id('SettingsButton')).tap();
    await element(by.id('NetworkSettings')).tap();
    await element(by.id('ElectrumSettings')).tap();
    await waitForId('ElectrumConnectionEnabledSwitch');
    if (!(await getSwitchValue('ElectrumConnectionEnabledSwitch'))) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
    await goBack();
    await goBack();
    await goBack();
    await step('create disposable artwork wallet', () => helperCreateWallet('Artwork Test Wallet', 'taproot'), 150000);
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
    // The retained log shows SpringBoard restarted after the previous early
    // attachment. Attach the selected simulator after all resets and launches.
    execFileSync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.id], { timeout: 15000 });
    await step('legacy home scroll before portrait', () => scrollUpOnHomeScreen());
    await capture('01-helmet-portrait', 'portrait');
    await capture('02-helmet-landscape', 'landscape', 'ArtworkSkinSurface', true);
    await capture('02b-helmet-return-portrait', 'portrait', 'ArtworkSkinSurface', true);
    // Preserve the immediate capture above, then separately observe whether the
    // wallet card settles into view without scrolling, tapping or relaunching.
    if (process.env.REDWALLET_INTERACTION_DIAGNOSTIC === 'rotation') {
      await step('return-portrait wallet card visible', () =>
        waitFor(element(by.id('Artwork Test Wallet')))
          .toBeVisible()
          .withTimeout(15000),
      );
      await capture('02c-helmet-return-portrait-settled', 'portrait');
      return; // This diagnostic cannot qualify a release or join a pool.
    }
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
      await capture('03-pool-discovery', 'portrait', 'CoinjoinLiveScreen');
      console.log('Native read-only pool discovery:', status);
    } finally {
      await device.enableSynchronization();
      execFileSync('xcrun', ['simctl', 'ui', device.id, 'appearance', 'light']);
    }
  });
});
