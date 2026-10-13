import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { HDSegwitBech32Transaction } from '../../class/hd-segwit-bech32-transaction';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { HDSegwitBech32Wallet } from '../../class/wallets/hd-segwit-bech32-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
}));
beforeEach(() => jest.clearAllMocks());

it('disables XBT BIP84 fee actions without disabling other wallet capabilities', () => {
  expect(new XbtSegwitBech32Wallet().allowRBF()).toBe(false);
  expect(new XbtTaprootWallet().allowRBF()).toBe(true);
  expect(new HDSegwitBech32Wallet().allowRBF()).toBe(true);
});

it.each(['createRBFbumpFee', 'createRBFcancelTx', 'createCPFPbumpFee'] as const)(
  'rejects direct %s before fetching attacker-controlled recipients or signing',
  async method => {
    const wallet = new XbtSegwitBech32Wallet();
    const sign = jest.spyOn(wallet, 'createTransaction');
    const tx = new HDSegwitBech32Transaction(null, '11'.repeat(32), wallet);
    (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockRejectedValue(new Error('attacker server reached'));
    await expect(tx[method](1000)).rejects.toThrow('XBT SegWit fee bumping is temporarily disabled');
    expect(BlueElectrum.multiGetTransactionByTxid).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
  },
);
