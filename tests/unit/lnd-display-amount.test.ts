import { formatLndAmount } from '../../blue_modules/lnd-display-amount';
import { createManualXbtPriceQuote, createNeoxexXbtPriceQuote } from '../../blue_modules/xbt-price';
import { LndWallet } from '../../class/wallets/lnd-wallet';
import { BitcoinUnit } from '../../models/bitcoinUnits';

test('preserves exact satoshis and decimal XBT, rounds only quote display, and never relabels USDC as USD', () => {
  const usd = createManualXbtPriceQuote('300', 'USD');
  const usdc = createNeoxexXbtPriceQuote('300', Date.now());
  expect(formatLndAmount('45998593', 'XBT')).toBe('0.45998593 XBT');
  expect(formatLndAmount('45998593', 'sats')).toBe('45,998,593 sats');
  expect(formatLndAmount('45998593', 'quote', usd)).toBe('≈ 138.00 USD');
  expect(formatLndAmount('45998593', 'quote', usdc)).toBe('≈ 138.00 USDC');
  expect(formatLndAmount('1', 'quote', usd)).toBe('≈ <0.01 USD');
  expect(formatLndAmount('0', 'quote', usd)).toBe('≈ 0.00 USD');
});

test.each(['-1', '1.5', '', 'NaN', '9007199254740992'])('refuses invalid monetary amount %s', value => {
  expect(formatLndAmount(value, 'XBT')).toBe('Amount unavailable');
});

test('missing and invalid quote cannot turn a nonzero balance into zero', () => {
  expect(formatLndAmount(1000, 'quote', null)).toBe('Rate unavailable');
  const quote = createManualXbtPriceQuote('300', 'USD');
  expect(formatLndAmount(1000, 'quote', { ...quote, pricePerXbt: 'NaN' })).toBe('Rate unavailable');
});

test('restores the display unit separately from the disabled legacy BTC fiat converter', () => {
  const wallet = new LndWallet();
  wallet.setDisplayUnit('sats');
  expect(wallet.getPreferredBalanceUnit()).toBe(BitcoinUnit.SATS);
  wallet.setDisplayUnit('quote');
  const restored = LndWallet.fromJson(JSON.stringify(wallet));
  expect(restored.getDisplayUnit()).toBe('quote');
  expect(restored.getPreferredBalanceUnit()).toBe(BitcoinUnit.SATS);
  expect(LndWallet.fromJson(JSON.stringify({ preferredBalanceUnit: BitcoinUnit.SATS })).getDisplayUnit()).toBe('sats');
  expect(LndWallet.fromJson(JSON.stringify({ displayUnit: 'invalid' })).getDisplayUnit()).toBe('XBT');
});
