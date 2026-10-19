/** Local output history. Never inferred from a memo, amount or server-provided label. */
import type { CreateTransactionTarget, CreateTransactionUtxo } from '../wallets/types';
import type { LegacyWallet } from '../wallets/legacy-wallet';
import { reservedCoins, ReservationWallet } from './kilojoin/wallet-store';
import { change } from './kilojoin/transaction';
import type { Terms } from './kilojoin/protocol';

export type CoinPrivacyRecord = { version: 1; role: 'mixed' | 'change'; txid: string };
export type CoinPrivacyStatus = 'mixed' | 'pending' | 'change' | 'unknown';
export type PrivacyMetadata = { coinjoin?: CoinPrivacyRecord; frozen?: boolean; memo?: string };
export type PrivacyWallet = { getUTXOMetadata(txid: string, vout: number): PrivacyMetadata };
type Outpoint = { txid: string; vout: number; confirmations?: number };

export function readCoinPrivacyRecord(value: unknown, txid: string): CoinPrivacyRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const record = value as CoinPrivacyRecord;
  if (record.version !== 1 || !['mixed', 'change'].includes(record.role) || record.txid !== txid || !/^[0-9a-f]{64}$/.test(txid)) return;
  return { version: 1, role: record.role, txid };
}

export function coinPrivacyStatus(wallet: PrivacyWallet, coin: Outpoint): CoinPrivacyStatus {
  const record = readCoinPrivacyRecord(wallet.getUTXOMetadata(coin.txid, coin.vout).coinjoin, coin.txid);
  if (!record) return 'unknown';
  if (record.role === 'change') return 'change';
  return Number.isSafeInteger(coin.confirmations) && coin.confirmations! > 0 ? 'mixed' : 'pending';
}

/** Pending mixed outputs also need protection; a reorg must not erase their history. */
export function combinesMixedCoins(wallet: PrivacyWallet, coins: Outpoint[]): boolean {
  const mixed = coins.map(
    coin => readCoinPrivacyRecord(wallet.getUTXOMetadata(coin.txid, coin.vout).coinjoin, coin.txid)?.role === 'mixed',
  );
  return mixed.some(Boolean) && mixed.some(value => !value);
}

type SelectionWallet = PrivacyWallet & ReservationWallet & Pick<LegacyWallet, 'coinselect'>;
export type PrivacySelection = { coins: CreateTransactionUtxo[]; fee: number; warning: boolean };

/** Use the wallet's own fee/dust-aware selector. No signing, mutation, or network access. */
export function selectPrivacyCoins(
  wallet: SelectionWallet,
  candidates: CreateTransactionUtxo[],
  targets: CreateTransactionTarget[],
  feeRate: number,
  automatic = true,
): PrivacySelection {
  const reserved = reservedCoins(wallet);
  const eligible = candidates.filter(
    coin => !wallet.getUTXOMetadata(coin.txid, coin.vout).frozen && !reserved.has(`${coin.txid}:${coin.vout}`),
  );
  if (!automatic && eligible.length !== candidates.length) throw new Error('Unfreeze or deselect unavailable coins before spending.');
  const select = (coins: CreateTransactionUtxo[]): PrivacySelection => {
    const result = wallet.coinselect(coins, targets, feeRate);
    const selected = result.inputs.map(input => {
      const original = coins.find(coin => coin.txid === input.txid && coin.vout === input.vout);
      if (!original) throw new Error('Coin selection returned an unknown input');
      return original;
    });
    return { coins: selected, fee: result.fee, warning: combinesMixedCoins(wallet, selected) };
  };
  // MAX must retain its meaning. Never silently turn "all" into a partial payment.
  if (!automatic || targets.some(target => target.value === undefined)) return select(eligible);
  const options: PrivacySelection[] = [];
  for (const status of ['unknown', 'mixed', 'change', 'pending'] as const) {
    const group = eligible.filter(coin => coinPrivacyStatus(wallet, coin) === status);
    if (!group.length) continue;
    try {
      options.push(select(group));
    } catch (error) {
      // Only insufficient funds permits trying another category. Preserve other failures.
      if (!(error instanceof Error) || !error.message.startsWith('Not enough balance')) throw error;
    }
  }
  if (options.length) return options.sort((a, b) => a.fee - b.fee || a.coins.length - b.coins.length)[0];
  // No single category covers the amount + fee. Caller must confirm any privacy warning.
  return select(eligible);
}

/** Approval applies to this selection only. Rejection prevents the caller from signing. */
export async function approvePrivacySelection(wallet: PrivacyWallet, coins: Outpoint[], confirm: () => Promise<boolean>): Promise<boolean> {
  return !combinesMixedCoins(wallet, coins) || (await confirm());
}

/** Suggest inputs for a pool, using its actual denomination, fee share, and input limit. */
export function suggestCoinjoinCoins<T extends Outpoint & { value: number }>(
  wallet: PrivacyWallet & ReservationWallet,
  candidates: T[],
  terms: Pick<Terms, 'denomination' | 'fee_rate' | 'script' | 'max_inputs'>,
  maxFee: number,
): T[] {
  if (
    !Number.isSafeInteger(maxFee) ||
    maxFee < 0 ||
    !Number.isSafeInteger(terms.max_inputs) ||
    terms.max_inputs < 1 ||
    terms.max_inputs > 10
  )
    throw new Error('Invalid fee or pool input limit');
  const reserved = reservedCoins(wallet);
  const available = candidates.filter(
    coin =>
      Number.isSafeInteger(coin.confirmations) &&
      coin.confirmations! > 0 &&
      !wallet.getUTXOMetadata(coin.txid, coin.vout).frozen &&
      !reserved.has(`${coin.txid}:${coin.vout}`),
  );
  const assess = (group: T[]) => {
    const options: { coins: T[]; fee: number; remainder: number }[] = [];
    const check = (coins: T[]) => {
      const total = coins.reduce((sum, coin) => sum + coin.value, 0);
      const remainder = change(total, terms.denomination, terms.fee_rate, coins.length, terms.script);
      if (remainder === null) return;
      const fee = total - terms.denomination - remainder;
      if (fee <= maxFee) options.push({ coins, fee, remainder });
    };
    group.forEach(coin => check([coin]));
    const ordered = [...group].sort((a, b) => b.value - a.value || a.txid.localeCompare(b.txid) || a.vout - b.vout);
    for (const list of [ordered, [...ordered].reverse()])
      for (let count = 2; count <= Math.min(list.length, terms.max_inputs); count++) check(list.slice(0, count));
    return options.sort((a, b) => a.coins.length - b.coins.length || a.fee - b.fee || a.remainder - b.remainder)[0];
  };
  const separate = (['unknown', 'mixed', 'change'] as const)
    .map(status => assess(available.filter(coin => coinPrivacyStatus(wallet, coin) === status)))
    .filter((option): option is NonNullable<typeof option> => !!option)
    .sort((a, b) => a.coins.length - b.coins.length || a.fee - b.fee || a.remainder - b.remainder);
  const selected = separate[0] ?? assess(available);
  if (!selected) throw new Error('No eligible coin selection covers this pool and your fee limit.');
  return selected.coins;
}
