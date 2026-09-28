import startImport from '../../class/wallet-import';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  getTransactionsByAddress: jest.fn().mockResolvedValue([]),
}));

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

  it('defaults an unused online BIP39 seed to XBT when account discovery finds no history', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const { promise } = startImport(
      mnemonic,
      false,
      false,
      false,
      () => {},
      () => {},
      async () => '',
    );

    const result = await promise;

    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0]).toBeInstanceOf(XbtSegwitBech32Wallet);
  });
});
