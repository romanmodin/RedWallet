import { BitcoinUnit } from '../../models/bitcoinUnits';
import { XBT_PROFILE } from './profile';

/** Balance preferences store satoshis; stale fiat display choices can safely return to XBT. */
export function normalizeXbtUnit(unit: BitcoinUnit | null | undefined): BitcoinUnit {
  if (!XBT_PROFILE.fiatEnabled) return unit === BitcoinUnit.SATS ? BitcoinUnit.SATS : BitcoinUnit.BTC;
  return unit && Object.values(BitcoinUnit).includes(unit) ? unit : BitcoinUnit.BTC;
}

export function nextXbtUnit(unit: BitcoinUnit): BitcoinUnit {
  const current = normalizeXbtUnit(unit);
  if (current === BitcoinUnit.BTC) return BitcoinUnit.SATS;
  if (current === BitcoinUnit.SATS && XBT_PROFILE.fiatEnabled) return BitcoinUnit.LOCAL_CURRENCY;
  return BitcoinUnit.BTC;
}
