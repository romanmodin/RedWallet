import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({}));

describe('XBT BIP84 address derivation', () => {
  it('matches the published BIP84 account xpub, receive addresses, and change address', () => {
    const wallet = new XbtSegwitBech32Wallet();
    wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');

    expect(wallet.getDerivationPath()).toBe("m/84'/0'/0'");
    expect(wallet.getXpub()).toBe(
      'zpub6rFR7y4Q2AijBEqTUquhVz398htDFrtymD9xYYfG1m4wAcvPhXNfE3EfH1r1ADqtfSdVCToUG868RvUUkgDKf31mGDtKsAYz2oz2AGutZYs',
    );
    expect(wallet._getExternalAddressByIndex(0)).toBe('bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu');
    expect(wallet._getExternalAddressByIndex(1)).toBe('bc1qnjg0jd8228aq7egyzacy8cys3knf9xvrerkf9g');
    expect(wallet._getInternalAddressByIndex(0)).toBe('bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el');
  });
});
