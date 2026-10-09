import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, AppStateStatus } from 'react-native';
import DefaultPreference from 'react-native-default-preference';

import {
  clearSavedXbtPriceQuote,
  createManualXbtPriceQuote,
  createNeoxexXbtPriceQuote,
  estimateXbtQuoteAmount,
  formatXbtQuoteEstimate,
  loadXbtPriceQuote,
  saveXbtPriceQuote,
  XBT_PRICE_STORAGE_KEY,
  XbtPriceQuote,
} from '../../blue_modules/xbt-price';
import { EXCHANGE_RATES_STORAGE_KEY, GROUP_IO_BLUEWALLET } from '../../blue_modules/currency';
import XbtFiatEstimate from '../../components/XbtFiatEstimate';
import { fetch } from '../../util/fetch';

let mockQuote: XbtPriceQuote | null = null;
jest.mock('../../hooks/context/useSettings', () => ({ useSettings: () => ({ xbtPriceQuote: mockQuote }) }));
jest.mock('../../util/fetch', () => ({ fetch: jest.fn() }));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});

const NOW = Date.UTC(2026, 8, 28, 12);
const mockStore = new Map<string, string | number | boolean>();
const preference = DefaultPreference as jest.Mocked<typeof DefaultPreference>;

function deferred<T>() {
  let complete!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

describe('XBT display quotes', () => {
  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
    jest.clearAllMocks();
    mockStore.clear();
    mockQuote = null;
    preference.setName.mockImplementation(() => {});
    preference.get.mockImplementation(async key => mockStore.get(key) ?? null);
    preference.set.mockImplementation(async (key, value) => {
      mockStore.set(key, value);
    });
    preference.clear.mockImplementation(async key => {
      mockStore.delete(key);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('validates decimal manual quotes and keeps USD separate from USDC', () => {
    expect(createManualXbtPriceQuote(' 000.1000 ', ' usd ')).toEqual({
      source: 'manual',
      pricePerXbt: '0.1',
      currency: 'USD',
      updatedAt: NOW,
    });
    expect(createManualXbtPriceQuote('.1', 'USDC').currency).toBe('USDC');
    for (const price of ['', '0', '-1', 'NaN', 'Infinity', '1e3', '1,000', '1000000000001', '0.0000000000001']) {
      expect(() => createManualXbtPriceQuote(price, 'USD')).toThrow();
    }
    for (const currency of ['', '$', 'U', '1USD', 'US D', 'ABCDEFGHIJKLM']) {
      expect(() => createManualXbtPriceQuote('1', currency)).toThrow();
    }
    for (const time of [0, -1, NOW + 60001, Number.MAX_SAFE_INTEGER, NaN]) {
      expect(() => createManualXbtPriceQuote('1', 'USD', time)).toThrow();
    }
  });

  it('preserves exchange trade time and rejects invalid fetch timestamps', () => {
    expect(createNeoxexXbtPriceQuote('12.34', NOW - 3600000)).toEqual({
      source: 'neoxex',
      pricePerXbt: '12.34',
      currency: 'USDC',
      updatedAt: NOW - 3600000,
      fetchedAt: NOW,
    });
    expect(() => createNeoxexXbtPriceQuote('1', 1000, -1)).toThrow();
    expect(() => createNeoxexXbtPriceQuote('1', NOW, NOW - 60001)).toThrow();
    expect(() => createNeoxexXbtPriceQuote('1', NOW, NOW + 60001)).toThrow();
  });

  it('persists an independent quote across loads and clears it without touching old BTC data', async () => {
    mockStore.set(EXCHANGE_RATES_STORAGE_KEY, JSON.stringify({ BTC_USD: 99999 }));
    expect(await loadXbtPriceQuote()).toBeNull();
    expect(preference.get).toHaveBeenCalledWith(XBT_PRICE_STORAGE_KEY);
    expect(preference.get).not.toHaveBeenCalledWith(EXCHANGE_RATES_STORAGE_KEY);
    const quote = createManualXbtPriceQuote('7.123456789012', 'USDC');
    await saveXbtPriceQuote(quote);
    expect(await loadXbtPriceQuote()).toEqual(quote);
    expect(preference.setName).toHaveBeenCalledWith(GROUP_IO_BLUEWALLET);
    await clearSavedXbtPriceQuote();
    expect(await loadXbtPriceQuote()).toBeNull();
    expect(mockStore.has(EXCHANGE_RATES_STORAGE_KEY)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects wrong sources, mislabelled exchange currency and corrupt stored values', async () => {
    const manual = createManualXbtPriceQuote('1', 'USD');
    const exchange = createNeoxexXbtPriceQuote('2', NOW);
    const invalid = [
      '{invalid',
      JSON.stringify(null),
      JSON.stringify([]),
      JSON.stringify({ ...manual, source: 'bitcoin' }),
      JSON.stringify({ ...manual, pricePerXbt: 1 }),
      JSON.stringify({ ...manual, updatedAt: Number.MAX_SAFE_INTEGER }),
      JSON.stringify({ ...exchange, currency: 'USD' }),
      JSON.stringify({ ...exchange, fetchedAt: 0 }),
    ];
    for (const saved of invalid) {
      mockStore.set(XBT_PRICE_STORAGE_KEY, saved);
      expect(await loadXbtPriceQuote()).toBeNull();
      expect(mockStore.has(XBT_PRICE_STORAGE_KEY)).toBe(false);
    }
    await saveXbtPriceQuote(exchange);
    expect(await loadXbtPriceQuote()).toEqual(exchange);
  });

  it('uses exact decimal multiplication for satoshis without changing quote currencies', () => {
    const quote = createManualXbtPriceQuote('0.1', 'USDC');
    expect(estimateXbtQuoteAmount(1, quote)).toBe('0.000000001');
    expect(formatXbtQuoteEstimate(1, quote)).toBe('0.00 USDC');
    expect(formatXbtQuoteEstimate(100000000, createManualXbtPriceQuote('1234.56', 'USD'))).toBe('1,234.56 USD');
    expect(estimateXbtQuoteAmount(123456789, createManualXbtPriceQuote('7.123456789012', 'USD'))).toBe('8.79439101751672002468');
    expect(estimateXbtQuoteAmount(0, quote)).toBe('0');
    expect(() => estimateXbtQuoteAmount(1.1, quote)).toThrow();
    expect(() => estimateXbtQuoteAmount(Number.MAX_SAFE_INTEGER + 1, quote)).toThrow();
  });

  it('rounds only USDC display to two decimals without rounding XBT or stored rates', () => {
    const quote = createNeoxexXbtPriceQuote('123.456789', NOW);
    expect(formatXbtQuoteEstimate(100000000, quote)).toBe('123.46 USDC');
    expect(formatXbtQuoteEstimate(123456789, createManualXbtPriceQuote('10', 'USDC'))).toBe('12.35 USDC');
    expect(estimateXbtQuoteAmount(123456789, createManualXbtPriceQuote('10', 'USDC'))).toBe('12.3456789');
    expect(formatXbtQuoteEstimate(100000000, createManualXbtPriceQuote('1.005', 'USDC'))).toBe('1.01 USDC');
    expect(formatXbtQuoteEstimate(100000000, createManualXbtPriceQuote('123.456789', 'USD'))).toBe('123.456789 USD');
    expect(quote.pricePerXbt).toBe('123.456789');
  });

  it('finishes invalid initial-cache cleanup before a newer save', async () => {
    const oldRead = deferred<string>();
    preference.get.mockImplementationOnce(() => oldRead.promise);
    const loading = loadXbtPriceQuote();
    await waitFor(() => expect(preference.get).toHaveBeenCalled());
    const quote = createManualXbtPriceQuote('42', 'USDC');
    const saving = saveXbtPriceQuote(quote);
    expect(preference.set).not.toHaveBeenCalled();
    oldRead.resolve('invalid old quote');
    expect(await loading).toBeNull();
    await saving;
    expect(await loadXbtPriceQuote()).toEqual(quote);
  });

  it('serializes save then clear so a delayed write cannot resurrect a cleared quote', async () => {
    const delayedWrite = deferred<void>();
    preference.set.mockImplementationOnce(async (key, value) => {
      await delayedWrite.promise;
      mockStore.set(key, value);
    });
    const saving = saveXbtPriceQuote(createManualXbtPriceQuote('42', 'USD'));
    await waitFor(() => expect(preference.set).toHaveBeenCalled());
    const clearing = clearSavedXbtPriceQuote();
    expect(preference.clear).not.toHaveBeenCalled();
    delayedWrite.resolve();
    await Promise.all([saving, clearing]);
    expect(await loadXbtPriceQuote()).toBeNull();
  });

  it('allows later operations after a persistence failure and keeps bad cache cleanup best effort', async () => {
    preference.set.mockRejectedValueOnce(new Error('Disk unavailable'));
    await expect(saveXbtPriceQuote(createManualXbtPriceQuote('1', 'USD'))).rejects.toThrow('Disk unavailable');
    await saveXbtPriceQuote(createManualXbtPriceQuote('2', 'USD'));
    expect((await loadXbtPriceQuote())?.pricePerXbt).toBe('2');
    mockStore.set(XBT_PRICE_STORAGE_KEY, 'bad');
    preference.clear.mockRejectedValueOnce(new Error('Disk unavailable'));
    expect(await loadXbtPriceQuote()).toBeNull();
  });

  it('updates displayed estimates when a saved quote changes and removes them after clear', () => {
    const view = render(<XbtFiatEstimate satoshis={100000000} />);
    expect(view.queryByTestId('XbtPriceEstimate')).toBeNull();
    mockQuote = createManualXbtPriceQuote('42', 'USD');
    view.rerender(<XbtFiatEstimate satoshis={100000000} />);
    expect(view.getByText('≈ 42.00 USD')).toBeTruthy();
    expect(view.getByText(`Manual · updated ${new Date(NOW).toLocaleString()}`)).toBeTruthy();
    mockQuote = createManualXbtPriceQuote('43', 'USDC');
    view.rerender(<XbtFiatEstimate satoshis={100000000} />);
    expect(view.getByText('≈ 43.00 USDC')).toBeTruthy();
    mockQuote = null;
    view.rerender(<XbtFiatEstimate satoshis={100000000} />);
    expect(view.queryByTestId('XbtPriceEstimate')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('hides an unusable quote after a clock rollback without breaking the wallet', () => {
    mockQuote = createManualXbtPriceQuote('42', 'USD');
    jest.spyOn(Date, 'now').mockReturnValue(NOW - 120000);
    const view = render(<XbtFiatEstimate satoshis={100000000} />);
    expect(view.queryByTestId('XbtPriceEstimate')).toBeNull();
  });

  it('updates exchange staleness as time passes and when returning to the app, with no network polling', () => {
    jest.useFakeTimers();
    let now = NOW;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const remove = jest.fn();
    let appStateChanged!: (state: AppStateStatus) => void;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      appStateChanged = listener;
      return { remove };
    });
    try {
      mockQuote = createNeoxexXbtPriceQuote('42', NOW - 14 * 60000);
      const view = render(<XbtFiatEstimate satoshis={100000000} />);
      expect(view.queryByText(/stale quote/)).toBeNull();
      act(() => {
        now += 60000;
        jest.advanceTimersByTime(60000);
      });
      expect(view.getByText(/NeoxEX · last trade .*stale quote/)).toBeTruthy();
      mockQuote = createNeoxexXbtPriceQuote('42', now);
      view.rerender(<XbtFiatEstimate satoshis={100000000} />);
      expect(view.queryByText(/stale quote/)).toBeNull();
      act(() => {
        now += 15 * 60000;
        appStateChanged('active');
      });
      expect(view.getByText(/stale quote/)).toBeTruthy();
      view.unmount();
      expect(remove).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      expect(fetch).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
