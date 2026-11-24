import { AbstractHDElectrumWallet } from '../../class/wallets/abstract-hd-electrum-wallet';
import type { TWallet } from '../../class/wallets/types';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';

export function changeAddressFallback(wallet: TWallet) {
  if (wallet instanceof AbstractHDElectrumWallet || (wallet instanceof WatchOnlyWallet && wallet.isHd())) {
    return wallet._getInternalAddressByIndex(wallet.getNextFreeChangeAddressIndex());
  }
  return wallet.getAddress();
}
