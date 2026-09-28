import { dismissAlertByText, waitForId, waitForText } from './helperz';

// if loglevel is set to `error`, this kind of logging will still get through
console.warn = console.log = (...args) => {
  let output = '';
  args.map(arg => (output += String(arg)));

  process.stdout.write('\n\t\t' + output + '\n');
};

describe('RedWallet XBT-only import', () => {
  it('rejects a watch-only zpub until its XBT chain identity is verified', async () => {
    await device.clearKeychain();
    await device.launchApp({ delete: true, permissions: { notifications: 'YES', camera: 'YES' } });
    await waitForId('CreateAWallet');
    await element(by.id('CreateAWallet')).tap();
    await waitForId('ImportWallet');
    await element(by.id('ImportWallet')).tap();
    await waitForId('MnemonicInput');
    await element(by.id('MnemonicInput')).replaceText(
      'zpub6s2EvLxwvDpaHNVP5vfordTyi8cH1fR8usmEjz7RsSQjfTTGU2qA5VEcEyYYBxpZAyBarJoTraB4VRJKVz97Au9jRNYfLAeeHC5UnRZbz8Y',
    );
    await element(by.id('DoImport')).tap();
    await waitForText('RedWallet currently imports a BIP39 recovery phrase for its XBT BIP84 wallet.', 30_000);
    if (!(await dismissAlertByText('OK'))) throw new Error('Could not dismiss unsupported import error');
    await expect(element(by.text('Imported XBT SegWit (BIP84)'))).not.toExist();
  });
});
