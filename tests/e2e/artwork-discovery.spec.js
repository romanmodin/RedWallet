import { prepareArtworkApp, setSimulatorAppearance } from './artwork-setup';
import { observeNativeSetupStep } from './native-setup-step';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { element, waitFor } from 'detox';
import {
  nativeCaptureEvidence,
  matchesNativeOrientation,
  shouldRepeatOrientation,
  observeNativeRotation,
  attachSimulatorForRotation,
} from './native-capture-helper';
import { getSwitchValue, goBack, helperCreateWallet, scrollUpOnHomeScreen, waitForId, waitForWalletsList } from './helperz';

const smoke = process.env.REDWALLET_VISUAL_SMOKE === '1' ? describe : describe.skip;
const captureObserved = async (name, orientation, surfaceId = 'ArtworkSkinSurface', rotate = false) => {
  const directory = path.resolve('artifacts/appearance-discovery');
  fs.mkdirSync(directory, { recursive: true });
  const started = Date.now();
  const deadline = started + 15000;
  let orientationRequests = 0;
  if (rotate) {
    await device.setOrientation(orientation);
    orientationRequests++;
  }
  let evidence;
  // simctl captures the physical framebuffer in portrait pixel coordinates even
  // when UIKit has rotated. Assert the actual native surface bounds, retain the
  // unmodified screenshot, and require human visual inspection of both views.
  do {
    const preCapture = await element(by.id(surfaceId)).getAttributes();
    const file = await device.takeScreenshot(name);
    const png = fs.readFileSync(file);
    // The screenshot request can advance a pending UIKit geometry update. Keep
    // the stale pre-capture sample for evidence, then require two matching
    // post-capture native measurements before accepting the orientation.
    const before = await element(by.id(surfaceId)).getAttributes();
    const after = await element(by.id(surfaceId)).getAttributes();
    evidence = nativeCaptureEvidence(png, before, after, orientation, preCapture);
    // Retain the last observed native state on failure as well as success.
    fs.copyFileSync(file, path.join(directory, name + '.png'));
    fs.writeFileSync(path.join(directory, name + '.json'), JSON.stringify({ surfaceId, orientationRequests, ...evidence }, null, 2) + '\n');
    if (matchesNativeOrientation(evidence)) return;
    if (shouldRepeatOrientation(evidence, Date.now() - started, orientationRequests)) {
      await device.setOrientation(orientation);
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
  return rotate ? observeNativeRotation(device, observation) : observation();
};
smoke('Native artwork framing and read-only CoinJoin discovery', () => {
  it('centers artwork on an empty wallet and completes a real pool search without joining', async () => {
    const setupDirectory = path.resolve('artifacts/appearance-discovery');
    fs.mkdirSync(setupDirectory, { recursive: true });
    const setup = async (name, action, timeoutMs = 60000) => {
      try {
        return await observeNativeSetupStep(
          name,
          action,
          entry => fs.appendFileSync(path.join(setupDirectory, 'setup-trace.jsonl'), JSON.stringify(entry) + '\n'),
          timeoutMs,
        );
      } catch (error) {
        // Independent of a potentially stalled Detox command queue. Failure to
        // capture must never replace or suppress the original setup failure.
        try {
          execFileSync('xcrun', ['simctl', 'io', device.id, 'screenshot', path.join(setupDirectory, 'setup-failure.png')], {
            timeout: 15000,
            stdio: 'pipe',
          });
        } catch {
          fs.appendFileSync(path.join(setupDirectory, 'setup-trace.jsonl'), JSON.stringify({ name, status: 'capture-unavailable' }) + '\n');
        }
        throw error;
      }
    };
    const appearance = await prepareArtworkApp({ device, setup, waitForReady: waitForWalletsList, run: execFileSync });
    fs.writeFileSync(path.join(setupDirectory, 'appearance.json'), JSON.stringify(appearance, null, 2) + '\n');
    await setup('open-settings', () => element(by.id('SettingsButton')).tap());
    await setup('open-network-settings', () => element(by.id('NetworkSettings')).tap());
    await setup('open-electrum-settings', () => element(by.id('ElectrumSettings')).tap());
    await setup('electrum-switch-visible', () => waitForId('ElectrumConnectionEnabledSwitch'));
    if (!(await getSwitchValue('ElectrumConnectionEnabledSwitch'))) await element(by.id('ElectrumConnectionEnabledSwitch')).tap();
    await goBack();
    await goBack();
    await goBack();
    await setup('create-disposable-artwork-wallet', () => helperCreateWallet('Artwork Test Wallet', 'taproot'));
    await setup('relaunch-artwork-wallet', () => device.launchApp({ newInstance: true }));
    await waitForWalletsList();
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(300, 'down');
    await element(by.id('ArtworkSkinLogo')).tap();
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toHaveLabel('Artwork skin: Helmet')
      .withTimeout(5000);
    await goBack();
    await waitForWalletsList();
    // Resetting Keychain or notification permissions can restart SpringBoard.
    // Attach after all resets/relaunches; native diagnostic 39691385530 verified
    // portrait, landscape and return-portrait bounds with this ordering.
    const attachment = attachSimulatorForRotation(execFileSync, device.id);
    fs.mkdirSync('artifacts/appearance-discovery', { recursive: true });
    fs.writeFileSync('artifacts/appearance-discovery/simulator-attachment.json', JSON.stringify(attachment, null, 2) + '\n');
    await scrollUpOnHomeScreen();
    await capture('01-helmet-portrait', 'portrait');
    await capture('02-helmet-landscape', 'landscape', 'ArtworkSkinSurface', true);
    await capture('02b-helmet-return-portrait', 'portrait', 'ArtworkSkinSurface', true);
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(300, 'down');
    await element(by.id('ArtworkSkinLogo')).tap();
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toHaveLabel('Artwork skin: Armour')
      .withTimeout(5000);
    await goBack();
    await waitForWalletsList();
    await scrollUpOnHomeScreen();
    await capture('02c-armour-portrait', 'portrait');
    await capture('02d-armour-landscape', 'landscape', 'ArtworkSkinSurface', true);
    await capture('02e-armour-return-portrait', 'portrait', 'ArtworkSkinSurface', true);
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(300, 'down');
    await element(by.id('ArtworkSkinLogo')).tap();
    await waitFor(element(by.id('ArtworkSkinLogo')))
      .toHaveLabel('Artwork skin: Off')
      .withTimeout(5000);
    await goBack();
    await waitForWalletsList();
    await expect(element(by.id('ArtworkSkinBackground'))).not.toExist();

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
      setSimulatorAppearance(execFileSync, device.id, 'light');
    }
  });
});
