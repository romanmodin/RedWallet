import AsyncStorage from '@react-native-async-storage/async-storage';
import { BitcoinUnit } from '../models/bitcoinUnits';

export type TotalBalanceDisplayMode = 'XBT' | 'sats' | 'quote' | 'hidden';
export const TOTAL_BALANCE_DISPLAY_MODE_KEY = 'redwallet.totalBalanceDisplayMode';
const modes: TotalBalanceDisplayMode[] = ['XBT', 'sats', 'quote', 'hidden'];

export function nextTotalBalanceDisplayMode(mode: TotalBalanceDisplayMode): TotalBalanceDisplayMode {
  return modes[(modes.indexOf(mode) + 1) % modes.length];
}

export async function loadTotalBalanceDisplayMode(legacyUnit: BitcoinUnit): Promise<TotalBalanceDisplayMode> {
  try {
    const saved = await AsyncStorage.getItem(TOTAL_BALANCE_DISPLAY_MODE_KEY);
    if (saved === null) {
      return legacyUnit === BitcoinUnit.SATS ? 'sats' : legacyUnit === BitcoinUnit.LOCAL_CURRENCY ? 'quote' : 'XBT';
    }
    return modes.includes(saved as TotalBalanceDisplayMode) ? (saved as TotalBalanceDisplayMode) : 'hidden';
  } catch {
    // A failed preference read must not reveal a previously hidden total.
    return 'hidden';
  }
}

export async function saveTotalBalanceDisplayMode(mode: TotalBalanceDisplayMode): Promise<void> {
  if (!modes.includes(mode)) throw new Error('Unsupported total balance display mode');
  // Keep failures observable: an unhide cannot succeed only in memory.
  await AsyncStorage.setItem(TOTAL_BALANCE_DISPLAY_MODE_KEY, mode);
}
