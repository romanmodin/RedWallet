import * as BlueElectrum from './BlueElectrum';
import * as BtcElectrum from './BtcElectrum';
import { formatBalance } from '../loc';
import { BitcoinUnit } from '../models/bitcoinUnits';

type WalletIdentity = { type: string; getID(): string };
export const isBtcWallet = (wallet?: { type: string } | null): boolean =>
  wallet?.type === 'HDsegwitBech32BTC' || wallet?.type === 'watchOnlyBTC';
export const walletTicker = (wallet?: { type: string } | null): 'BTC' | 'XBT' => (isBtcWallet(wallet) ? 'BTC' : 'XBT');
export const walletElectrum = (wallet?: WalletIdentity | null) =>
  isBtcWallet(wallet) && wallet ? BtcElectrum.forWallet(wallet.getID()) : BlueElectrum;
export const selectWalletNetwork = (wallet?: WalletIdentity | null) =>
  BtcElectrum.selectWallet(isBtcWallet(wallet) ? wallet!.getID() : undefined);
export const formatWalletBalance = (wallet: { type: string } | null | undefined, sats: number, unit: string, formatted = false) => {
  const value = formatBalance(sats, unit, formatted);
  return isBtcWallet(wallet) && unit === BitcoinUnit.BTC ? value.replace(/\s\S+$/, ' BTC') : value;
};
