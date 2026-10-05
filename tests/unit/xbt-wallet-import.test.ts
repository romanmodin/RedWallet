import startImport from '../../class/wallet-import';
import * as recovery from '../../class/xbt/recovery-discovery';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  getTransactionsByAddress: jest.fn().mockResolvedValue([]),
}));

describe.each([true, false])('pending recovery request, stopped=%s', stopped => {
  it('preserves partial discoveries on Stop and still rejects genuine active failures', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const wallet = new XbtSegwitBech32Wallet();
    wallet.setSecret(mnemonic);
    let rejectRequest!: (error: Error) => void;
    let enteredRequest!: () => void;
    const entered = new Promise<void>(resolve => {
      enteredRequest = resolve;
    });
    const request = new Promise<void>((_resolve, reject) => {
      rejectRequest = reject;
    });
    const scan = jest.spyOn(recovery, 'discoverXbtRecovery').mockImplementation(async function* () {
      yield { wallet };
      enteredRequest();
      await request;
    });
    const onWallet = jest.fn();
    try {
      const task = startImport(
        mnemonic,
        false,
        true,
        false,
        () => {},
        onWallet,
        async () => '',
        true,
      );
      await entered;
      if (stopped) task.stop();
      rejectRequest(new Error('Electrum request timeout'));
      if (stopped) {
        await expect(task.promise).resolves.toEqual({ cancelled: false, stopped: true, wallets: [wallet] });
      } else {
        await expect(task.promise).rejects.toThrow('Electrum request timeout');
      }
      expect(onWallet).toHaveBeenCalledTimes(1);
      expect(onWallet).toHaveBeenCalledWith(wallet);
    } finally {
      scan.mockRestore();
    }
  });
});

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

  it('accepts a BIP39 recovery phrase in the XBT-only import flow without scanning Bitcoin accounts', async () => {
    const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
    const { promise } = startImport(
      mnemonic,
      false,
      false,
      false,
      () => {},
      () => {},
      async () => '',
      true,
    );

    const result = await promise;

    expect(result.wallets).toHaveLength(1);
    expect(result.wallets[0]).toBeInstanceOf(XbtSegwitBech32Wallet);
    expect((result.wallets[0] as XbtSegwitBech32Wallet).getDerivationPath()).toBe(XbtSegwitBech32Wallet.derivationPath);
  });

  it('rejects non-mnemonic imports in the XBT-only import flow', async () => {
    const { promise } = startImport(
      'not a recovery phrase',
      false,
      false,
      true,
      () => {},
      () => {},
      async () => '',
      true,
    );

    await expect(promise).rejects.toThrow('RedWallet currently imports a BIP39 recovery phrase');
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

it('imports a BIP84 public account read-only until an XBT signer is explicitly enabled', async () => {
  const hot = new XbtSegwitBech32Wallet();
  hot.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const { promise } = startImport(
    hot.getXpub(),
    false,
    false,
    true,
    () => {},
    () => {},
    async () => '',
    true,
  );
  const { wallets } = await promise;
  expect(wallets).toHaveLength(1);
  expect(wallets[0].type).toBe('watchOnly');
  expect(wallets[0].allowSend()).toBe(false);
  expect(wallets[0].getSecret()).toBe(hot.getXpub());
});
