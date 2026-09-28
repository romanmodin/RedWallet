import React, { useState } from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import DefaultPreference from 'react-native-default-preference';

import {
  _setExchangeRate,
  BTCToLocalCurrency,
  EXCHANGE_RATES_STORAGE_KEY,
  fiatToBTC,
  GROUP_IO_BLUEWALLET,
  initCurrencyDaemon,
  isRateOutdated,
  mostRecentFetchedRate,
  restoreSavedPreferredFiatCurrencyAndExchangeFromStorage,
  satoshiToLocalCurrency,
  updateExchangeRate,
} from '../../blue_modules/currency';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XBT_PROFILE } from '../../class/xbt/profile';
import { nextXbtUnit, normalizeXbtUnit } from '../../class/xbt/units';
import { AmountInput, getCachedSatoshis, setCachedSatoshis } from '../../components/AmountInput';
import { formatBalance, formatBalanceWithoutSuffix } from '../../loc';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { getFiatRate } from '../../models/fiatUnit';
import { fetch } from '../../util/fetch';
import {
  calculateBalanceAndTransactionTime,
  isBalanceDisplayAllowed,
  setBalanceDisplayAllowed,
} from '../../hooks/useWidgetCommunication.ios';

jest.mock('../../util/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../../blue_modules/BlueElectrum', () => ({}));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});

function AmountHarness({ initialUnit = BitcoinUnit.BTC }: { initialUnit?: BitcoinUnit }) {
  const [amount, setAmount] = useState('1');
  const [unit, setUnit] = useState<BitcoinUnit>(initialUnit);
  return <AmountInput amount={amount} unit={unit} onChangeText={setAmount} onAmountUnitChange={setUnit} />;
}

describe('XBT fiat safety', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fetch Bitcoin prices, even when the inherited rate adapter is called directly', async () => {
    expect(XBT_PROFILE.fiatEnabled).toBe(false);
    await updateExchangeRate();
    await expect(getFiatRate('USD')).rejects.toThrow('Fiat conversion is unavailable for XBT');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears persisted Bitcoin rates and refuses cached conversion in either direction', async () => {
    await DefaultPreference.setName(GROUP_IO_BLUEWALLET);
    await DefaultPreference.set(EXCHANGE_RATES_STORAGE_KEY, JSON.stringify({ BTC_USD: 100000, LAST_UPDATED: Date.now() }));
    await initCurrencyDaemon();
    await restoreSavedPreferredFiatCurrencyAndExchangeFromStorage();
    expect(DefaultPreference.clear).toHaveBeenCalledWith(EXCHANGE_RATES_STORAGE_KEY);
    expect(await DefaultPreference.get(EXCHANGE_RATES_STORAGE_KEY)).toBeFalsy();
    _setExchangeRate('BTC_USD', 100000);
    expect(satoshiToLocalCurrency(100000000)).toBe('');
    expect(BTCToLocalCurrency(1)).toBe('');
    expect(() => fiatToBTC(100)).toThrow('Fiat conversion is unavailable for XBT');
    expect(await mostRecentFetchedRate()).toEqual({ LastUpdated: null, Rate: null });
    expect(await isRateOutdated()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stays unavailable when best-effort removal of the obsolete rate cache fails', async () => {
    const clearSpy = jest.spyOn(DefaultPreference, 'clear').mockRejectedValueOnce(new Error('Storage unavailable'));
    const warningSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(initCurrencyDaemon()).resolves.toBeUndefined();
      expect(satoshiToLocalCurrency(100000000)).toBe('');
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      clearSpy.mockRestore();
      warningSpy.mockRestore();
    }
  });

  it('keeps exact XBT/sat formatting when old balance preferences request fiat', () => {
    expect(formatBalance(123456789, BitcoinUnit.LOCAL_CURRENCY)).toBe('1.23456789 XBT');
    expect(formatBalanceWithoutSuffix(123456789, BitcoinUnit.LOCAL_CURRENCY)).toBe('1.23456789');
    expect(formatBalance(123456789, BitcoinUnit.SATS)).toBe('123456789 sats');
    expect(normalizeXbtUnit(BitcoinUnit.LOCAL_CURRENCY)).toBe(BitcoinUnit.BTC);
    expect(nextXbtUnit(BitcoinUnit.BTC)).toBe(BitcoinUnit.SATS);
    expect(nextXbtUnit(BitcoinUnit.SATS)).toBe(BitcoinUnit.BTC);
    const wallet = new XbtSegwitBech32Wallet();
    wallet.setPreferredBalanceUnit(BitcoinUnit.LOCAL_CURRENCY);
    expect(wallet.getPreferredBalanceUnit()).toBe(BitcoinUnit.BTC);
    // Simulate an older serialized wallet loaded before the setter guard existed.
    Object.assign(wallet, { preferredBalanceUnit: BitcoinUnit.LOCAL_CURRENCY });
    expect(wallet.getPreferredBalanceUnit()).toBe(BitcoinUnit.BTC);
  });

  it('cycles the actual amount input between XBT and sats with no fiat option', () => {
    const { getByTestId, queryByText } = render(<AmountHarness />);
    fireEvent.press(getByTestId('changeAmountUnitButton'));
    expect(getByTestId('BitcoinAmountInput').props.value).toBe('100000000');
    fireEvent.press(getByTestId('changeAmountUnitButton'));
    expect(getByTestId('BitcoinAmountInput').props.value).toBe('1');
    expect(queryByText('$')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clears obsolete fiat input instead of interpreting its number as XBT', async () => {
    setCachedSatoshis('1', '1000');
    expect(getCachedSatoshis('1')).toBeUndefined();
    const { getByTestId } = render(<AmountHarness initialUnit={BitcoinUnit.LOCAL_CURRENCY} />);
    await waitFor(() => expect(getByTestId('BitcoinAmountInput').props.value).toBe('0'));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not expose wallet balances to the disabled companion widgets', async () => {
    const wallet = new XbtSegwitBech32Wallet();
    const balanceSpy = jest.spyOn(wallet, 'getBalance');
    await setBalanceDisplayAllowed(true);
    expect(await isBalanceDisplayAllowed()).toBe(false);
    expect(await calculateBalanceAndTransactionTime([wallet], true)).toEqual({ allWalletsBalance: 0, latestTransactionTime: 0 });
    expect(balanceSpy).not.toHaveBeenCalled();
    expect(DefaultPreference.set).toHaveBeenCalledWith('WidgetCommunicationDisplayBalanceAllowed', '0');
    expect(DefaultPreference.set).toHaveBeenCalledWith('WidgetCommunicationAllWalletsSatoshiBalance', '0');
  });

  it('uses the RedWallet app group declared by the signed iOS targets', () => {
    expect(GROUP_IO_BLUEWALLET).toBe('group.com.romanmodin.redwallet');
  });
});
