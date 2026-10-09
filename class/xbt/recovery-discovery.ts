import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XbtSegwitBech32Wallet } from '../wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../wallets/xbt-taproot-wallet';

export type RecoveryScanOptions = { gapLimit?: number; accountLimit?: number };
type RecoveryWallet = XbtSegwitBech32Wallet | XbtTaprootWallet;

/** A bounded history search. Empty balances are not evidence that an account was never used. */
export async function* discoverXbtRecovery(
  secret: string,
  passphrase: string | undefined,
  options: RecoveryScanOptions,
  isRunning: () => boolean,
): AsyncGenerator<{ progress?: string; wallet?: RecoveryWallet }> {
  const gapLimit = options.gapLimit ?? 20;
  const accountLimit = options.accountLimit ?? 3;
  if (![20, 100].includes(gapLimit) || ![3, 10].includes(accountLimit)) throw new Error('Invalid recovery scan limits');
  const checkRunning = () => {
    if (!isRunning()) throw new Error('Discovery stopped');
  };
  for (const Wallet of [XbtSegwitBech32Wallet, XbtTaprootWallet]) {
    for (let account = 0; account < accountLimit; account++) {
      checkRunning();
      const wallet = new Wallet();
      wallet.setDerivationPath(`m/${Wallet === XbtTaprootWallet ? 86 : 84}'/0'/${account}'`);
      wallet.setSecret(secret);
      if (passphrase !== undefined) wallet.setPassphrase(passphrase);
      wallet.gap_limit = gapLimit;
      let used = false;
      for (const change of [false, true]) {
        let index = 0;
        let empty = 0;
        let highestUsed = -1;
        while (empty < gapLimit) {
          checkRunning();
          if (index >= 10000) throw new Error('Recovery scan reached its address limit; recovery is incomplete');
          const count = Math.min(20, gapLimit - empty, 10000 - index);
          const addresses = Array.from({ length: count }, (_, offset) =>
            change ? wallet._getInternalAddressByIndex(index + offset) : wallet._getExternalAddressByIndex(index + offset),
          );
          const histories = await BlueElectrum.multiGetHistoryByAddress(addresses, 20);
          checkRunning();
          for (const address of addresses) {
            const history = histories[address];
            if (
              !Array.isArray(history) ||
              history.some(entry => !/^[a-f0-9]{64}$/i.test(entry.tx_hash) || !Number.isSafeInteger(entry.height) || entry.height < -1)
            ) {
              throw new Error('Incomplete or invalid recovery history response');
            }
            if (history.length) {
              used = true;
              highestUsed = index;
              empty = 0;
            } else {
              empty++;
            }
            index++;
          }
          yield {
            progress: `${Wallet === XbtTaprootWallet ? 'Taproot' : 'Native SegWit'} · account ${account} · ${change ? 'change' : 'receive'} · ${index}`,
          };
        }
        if (change) wallet.next_free_change_address_index = highestUsed + 1;
        else wallet.next_free_address_index = highestUsed + 1;
      }
      if (used) {
        checkRunning();
        await wallet.fetchBalance();
        checkRunning();
        await wallet.fetchTransactions();
        checkRunning();
        yield { wallet };
      }
    }
  }
}
