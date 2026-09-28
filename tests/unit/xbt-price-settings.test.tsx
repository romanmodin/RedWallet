import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react-native';

import type { XbtPriceQuote } from '../../blue_modules/xbt-price';
import XbtPrice from '../../screen/settings/XbtPrice';

const NOW = Date.UTC(2026, 8, 28, 19, 0, 0);
const mockSave = jest.fn<Promise<void>, [string, string]>();
const mockClear = jest.fn<Promise<void>, []>();
const mockRefresh = jest.fn<Promise<void>, []>();
let mockQuote: XbtPriceQuote | null = null;

jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({
    xbtPriceQuote: mockQuote,
    saveManualXbtPriceQuote: mockSave,
    clearXbtPriceQuote: mockClear,
    refreshNeoxexXbtPriceQuote: mockRefresh,
  }),
}));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

function pendingOperation() {
  let complete!: () => void;
  const promise = new Promise<void>(resolve => {
    complete = resolve;
  });
  return { promise, resolve: complete };
}

describe('XBT price settings', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    mockQuote = null;
    mockSave.mockReset().mockResolvedValue(undefined);
    mockClear.mockReset().mockResolvedValue(undefined);
    mockRefresh.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
  });

  it('does not refresh the market price on mount or while the quote clock advances', () => {
    mockQuote = { source: 'neoxex', pricePerXbt: '0.019', currency: 'USDC', updatedAt: NOW - 60000, fetchedAt: NOW };
    const { getByTestId } = render(<XbtPrice />);
    expect(getByTestId('XbtPriceSavedQuote')).toHaveTextContent('1 XBT = 0.019 USDC');
    act(() => jest.advanceTimersByTime(5 * 60000));
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('refreshes only on request and locks edits and every action until the operation finishes', async () => {
    const pending = pendingOperation();
    mockRefresh.mockReturnValueOnce(pending.promise);
    const { getByTestId } = render(<XbtPrice />);
    fireEvent.press(getByTestId('RefreshNeoxexXbtPrice'));

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(getByTestId('XbtPriceInput').props.editable).toBe(false);
    expect(getByTestId('XbtQuoteCurrencyInput').props.editable).toBe(false);
    for (const id of ['RefreshNeoxexXbtPrice', 'SaveXbtPrice', 'ClearXbtPrice']) {
      expect(getByTestId(id)).toBeDisabled();
      fireEvent.press(getByTestId(id));
    }
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();

    await act(async () => {
      pending.resolve();
      await pending.promise;
    });
    expect(getByTestId('XbtPriceInput').props.editable).toBe(true);
    expect(getByTestId('XbtQuoteCurrencyInput').props.editable).toBe(true);
    for (const id of ['RefreshNeoxexXbtPrice', 'SaveXbtPrice', 'ClearXbtPrice']) expect(getByTestId(id)).toBeEnabled();
    expect(getByTestId('XbtPriceStatus')).toHaveTextContent('Refreshed from NeoxEX');
  });

  it('retains the saved quote and shows a useful error when a requested refresh fails', async () => {
    mockQuote = { source: 'manual', pricePerXbt: '0.025', currency: 'USD', updatedAt: NOW - 3600000 };
    mockRefresh.mockRejectedValueOnce(new Error('NeoxEX is unavailable'));
    const { getByTestId } = render(<XbtPrice />);
    await act(async () => {
      fireEvent.press(getByTestId('RefreshNeoxexXbtPrice'));
    });

    expect(getByTestId('XbtPriceError')).toHaveTextContent('Unable to refresh from NeoxEX: NeoxEX is unavailable');
    expect(getByTestId('XbtPriceSavedQuote')).toHaveTextContent('1 XBT = 0.025 USD');
    expect(getByTestId('XbtPriceSource')).toHaveTextContent('Source: Manual');
    expect(getByTestId('XbtPriceInput').props.value).toBe('0.025');
    expect(getByTestId('XbtQuoteCurrencyInput').props.value).toBe('USD');
    expect(getByTestId('RefreshNeoxexXbtPrice')).toBeEnabled();
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockClear).not.toHaveBeenCalled();
  });

  it('sends the exact entered decimal and uppercase quote label when saving a manual price', async () => {
    const { getByTestId } = render(<XbtPrice />);
    fireEvent.changeText(getByTestId('XbtPriceInput'), '0.000123456789');
    fireEvent.changeText(getByTestId('XbtQuoteCurrencyInput'), 'usdc');
    await act(async () => {
      fireEvent.press(getByTestId('SaveXbtPrice'));
    });

    expect(mockSave).toHaveBeenCalledWith('0.000123456789', 'USDC');
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(getByTestId('XbtPriceStatus')).toHaveTextContent('Saved');
  });

  it('labels a manual quote with its saved update time and no market stale badge', () => {
    const updatedAt = NOW - 3600000;
    mockQuote = { source: 'manual', pricePerXbt: '0.025', currency: 'USD', updatedAt };
    const { getByTestId, queryByTestId } = render(<XbtPrice />);
    expect(getByTestId('XbtPriceSource')).toHaveTextContent('Source: Manual');
    expect(getByTestId('XbtPriceTimestamp')).toHaveTextContent(`Updated: ${new Date(updatedAt).toLocaleString()}`);
    expect(queryByTestId('XbtPriceStale')).toBeNull();
  });

  it('uses the actual NeoxEX trade time and marks it stale at 15 minutes despite a recent fetch', () => {
    const tradeTime = NOW - 14 * 60000;
    mockQuote = { source: 'neoxex', pricePerXbt: '0.019', currency: 'USDC', updatedAt: tradeTime, fetchedAt: NOW };
    const { getByTestId, queryByTestId } = render(<XbtPrice />);
    expect(getByTestId('XbtPriceSource')).toHaveTextContent('Source: NeoxEX');
    expect(getByTestId('XbtPriceTimestamp')).toHaveTextContent(`Last trade: ${new Date(tradeTime).toLocaleString()}`);
    expect(queryByTestId('XbtPriceStale')).toBeNull();

    act(() => jest.advanceTimersByTime(60000));
    expect(getByTestId('XbtPriceStale')).toHaveTextContent('Stale: quote is at least 15 minutes old.');
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
