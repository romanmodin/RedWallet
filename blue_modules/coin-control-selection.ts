import type { Utxo } from '../class/wallets/types';

/** Recheck after persistence and return current outputs, never stale route objects. */
export function availableCoinSelection(
  wallet: {
    getUtxo: () => Utxo[];
    getUTXOMetadata: (txid: string, vout: number) => { frozen?: boolean };
  },
  selected: Utxo[],
): Utxo[] {
  const key = (coin: Utxo) => `${coin.txid}:${coin.vout}`;
  const available = new Map(wallet.getUtxo().map(coin => [key(coin), coin]));
  if (!selected.length || new Set(selected.map(key)).size !== selected.length) throw new Error('Select available coins to continue.');
  return selected.map(coin => {
    const current = available.get(key(coin));
    if (!current || wallet.getUTXOMetadata(coin.txid, coin.vout).frozen)
      throw new Error('A selected coin is frozen, reserved or no longer available. Review your selection in Coin Control.');
    return current;
  });
}
