import { XbtSegwitBech32Wallet } from './wallets/xbt-segwit-bech32-wallet';

type PayjoinCapability = { type: string; allowPayJoin(): boolean };

export function supportsPayjoin(wallet: PayjoinCapability | null | undefined): boolean {
  return (
    !!wallet && wallet.type !== XbtSegwitBech32Wallet.type && typeof wallet.allowPayJoin === 'function' && wallet.allowPayJoin() === true
  );
}

export function getPayjoinUrl(wallet: PayjoinCapability | null | undefined, url: string | null | undefined): string {
  return supportsPayjoin(wallet) ? url || '' : '';
}

export function assertPayjoinSupported(wallet: PayjoinCapability): void {
  if (!supportsPayjoin(wallet)) throw new Error('Payjoin is not supported by this wallet');
}
