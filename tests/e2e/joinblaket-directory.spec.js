import fs from 'node:fs';
import path from 'node:path';
import { element, waitFor } from 'detox';
import { resetSelftestDevice } from './selftest-reset';
import { waitForWalletsList } from './helperz';

const probe = process.env.REDWALLET_JOINBLAKET_PROBE === '1' ? describe : describe.skip;

probe('JoinBlaket authenticated read-only directory through the native Tor bridge', () => {
  it('authenticates from Hermes and collects certified offers without using a wallet', async () => {
    if (device.getPlatform() !== 'ios') throw new Error('This qualification requires the native iOS Tor bridge');
    await resetSelftestDevice(device);
    await waitForWalletsList();
    await element(by.id('SettingsButton')).tap();
    await waitFor(element(by.id('AboutButton')))
      .toBeVisible()
      .whileElement(by.id('SettingsRoot'))
      .scroll(500, 'down');
    await element(by.id('AboutButton')).tap();
    await waitFor(element(by.id('AboutScrollView')))
      .toBeVisible()
      .withTimeout(15000);
    await waitFor(element(by.id('RunSelfTestButton')))
      .toBeVisible()
      .whileElement(by.id('AboutScrollView'))
      .scroll(500, 'down');
    await element(by.id('RunSelfTestButton')).tap();
    await waitFor(element(by.id('JoinBlaketProbeStart')))
      .toBeVisible()
      .whileElement(by.id('SelfTestScrollView'))
      .scroll(400, 'down');

    await device.disableSynchronization();
    try {
      await element(by.id('JoinBlaketProbeStart')).tap();
      const deadline = Date.now() + 310000;
      let text = '';
      while (Date.now() < deadline) {
        const attributes = await element(by.id('JoinBlaketProbeStatus')).getAttributes();
        text = attributes.text || attributes.label || '';
        if (text.startsWith('Tor authentication passed.')) break;
        if (/^Check (failed|cancelled|timeout) during /.test(text) || text.startsWith('Could not complete')) throw new Error(text);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      const match = text.match(/^Tor authentication passed\. Certified offers: (\d+)\. Makers: (\d+)\.$/);
      if (!match) throw new Error('No authenticated market summary');
      const certifiedOffers = Number(match[1]),
        makers = Number(match[2]);
      if (certifiedOffers < 1 || makers < 1) throw new Error('No live certified offer received; market compatibility is unqualified');
      const folder = path.resolve('artifacts/joinblaket-directory');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(
        path.join(folder, 'summary.json'),
        JSON.stringify(
          {
            source: process.env.QUALIFIED_SOURCE,
            authenticated: true,
            certifiedOffers,
            makers,
            chainVerified: false,
            paymentsEnabled: false,
          },
          null,
          2,
        ) + '\n',
      );
      console.log('[joinblaket] native Tor authentication and certified market retrieval passed', { certifiedOffers, makers });
    } catch (error) {
      const status = await element(by.id('JoinBlaketProbeStatus'))
        .getAttributes()
        .catch(() => ({}));
      console.log('[joinblaket] last diagnostic status', status.text || status.label || 'unavailable');
      await device.takeScreenshot('joinblaket-directory-failure').catch(() => {});
      throw error;
    } finally {
      // This dedicated single-test process ends here. A synchronization command
      // after termination cannot reach the app and masks the probe result.
      await device.terminateApp();
    }
  }, 420000);
});
