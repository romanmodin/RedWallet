import { execFileSync } from 'node:child_process';
import { element, waitFor } from 'detox';
import { step } from './interaction-diagnostic-journal';
import { waitForWalletsList } from './helperz';

const diagnostic = process.env.REDWALLET_INTERACTION_DIAGNOSTIC === 'scroll' ? describe : describe.skip;
diagnostic('Nonqualifying empty-wallet navigation diagnostic', () => {
  it('scrolls the actual vertical home list without triggering pull-to-refresh and opens recovery', async () => {
    // Recorded reset completed in 32.7 seconds; this setup limit is not a UI assertion.
    await step('clear disposable keychain', () => device.clearKeychain(), 60000);
    await step(
      'fresh app launch',
      () =>
        device.launchApp({
          // This isolated spec runs after Detox's default fresh installation.
          // Do not repeat uninstall/install or terminate a never-launched app.
          newInstance: false,
          permissions: { notifications: 'NO' },
        }),
      120000,
    );
    // Keychain/permission resets can restart SpringBoard. Attach only afterward.
    execFileSync('open', ['-a', 'Simulator', '--args', '-CurrentDeviceUDID', device.id], { timeout: 15000 });
    await step('home ready', () => waitForWalletsList(15000));
    await step('empty home screenshot', () => device.takeScreenshot('diagnostic-empty-home'));
    // Wallets is the vertical SectionList; WalletsList is its horizontal carousel.
    // A downward swipe can invoke refresh. Direct scrollTo must not do so.
    await step('vertical home scrollTo top', () => element(by.id('Wallets')).scrollTo('top'));
    await step('add-wallet visibility', () =>
      waitFor(element(by.id('CreateAWallet')))
        .toBeVisible()
        .withTimeout(15000),
    );
    await step('open add-wallet', () => element(by.id('CreateAWallet')).tap());
    await step('import control visible', () =>
      waitFor(element(by.id('ImportWallet')))
        .toBeVisible()
        .withTimeout(15000),
    );
    await step('open recovery', () => element(by.id('ImportWallet')).tap());
    await step('recovery screen visible', () =>
      waitFor(element(by.id('ImportWalletScroll')))
        .toBeVisible()
        .withTimeout(15000),
    );
    // Stop before entering any phrase, fetching funds, signing, or broadcasting.
    await step('empty recovery screenshot', () => device.takeScreenshot('diagnostic-empty-recovery'));
  }, 300000);
});
