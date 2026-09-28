import startImport from '../../class/wallet-import';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({}));

describe('XBT mnemonic wallet restoration', () => {
  it('restores the default BIP84 account with the XBT Unified Sighash wallet type', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const { promise } = startImport(
      mnemonic,
      false,
      false,
      true,
      () => {},
      () => {},
      async () => '',
    );

    const result = await promise;
    const wallet = result.wallets.find(candidate => candidate.type === XbtSegwitBech32Wallet.type);

    expect(wallet).toBeInstanceOf(XbtSegwitBech32Wallet);
  });
});
