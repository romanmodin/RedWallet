// Monetary-domain / exact-integer bounds, not beta spending allowances.
// Keep native validation in sync. LND applies balance, dust, reserve and peer rules.
export const MAX_LIGHTNING_SATS = 2_100_000_000_000_000;
// User-selected cap for opening new channels; existing channels can still be resized.
export const MAX_LIGHTNING_CHANNEL_OPEN_SATS = 10_000_000;
// LND multiplies sat/kvB by vsize before dividing by 1000. Allow the 3x
// close ceiling and any consensus-valid transaction (1,000,000 vB), including
// its rounding increment, without overflowing signed Int64 intermediates.
// floor((Int64.max - 999) / (3 * 1000 * 1_000_000)); no beta fee allowance.
export const MAX_LIGHTNING_FEE_RATE = 3_074_457_345;

export function validLightningSats(value: string, allowZero = false): boolean {
  return (
    /^(0|[1-9][0-9]*)$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) >= (allowZero ? 0 : 1) &&
    Number(value) <= MAX_LIGHTNING_SATS
  );
}

export function validLightningChannelOpenSats(value: string): boolean {
  return validLightningSats(value) && Number(value) <= MAX_LIGHTNING_CHANNEL_OPEN_SATS;
}

export function validLightningFeeRate(value: string): boolean {
  return /^[1-9][0-9]*$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= MAX_LIGHTNING_FEE_RATE;
}
