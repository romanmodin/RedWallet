import React, { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppState, AppStateStatus, Text } from 'react-native';
import { useXbtDisplayPrice } from '../../hooks/useXbtDisplayPrice';
import { fetchNeoxexPrice } from '../../blue_modules/neoxex-price';
import {
  XbtPriceQuote,
  createNeoxexXbtPriceQuote,
  createManualXbtPriceQuote,
  loadXbtPriceQuote,
  saveXbtPriceQuote,
  clearSavedXbtPriceQuote,
  formatXbtQuoteEstimate,
} from '../../blue_modules/xbt-price';

jest.mock('../../blue_modules/neoxex-price', () => ({ fetchNeoxexPrice: jest.fn() }));
jest.mock('../../blue_modules/xbt-price', () => ({
  ...jest.requireActual('../../blue_modules/xbt-price'),
  loadXbtPriceQuote: jest.fn(),
  saveXbtPriceQuote: jest.fn(),
  clearSavedXbtPriceQuote: jest.fn(),
}));
const load = jest.mocked(loadXbtPriceQuote);
const save = jest.mocked(saveXbtPriceQuote);
const clear = jest.mocked(clearSavedXbtPriceQuote);
const fetchPrice = jest.mocked(fetchNeoxexPrice);
const NOW = Date.UTC(2026, 9, 8, 12);
const initialState = AppState.currentState;
let changed: (state: AppStateStatus) => void;
let remove: jest.Mock;
let current: ReturnType<typeof useXbtDisplayPrice>;
function Probe() {
  const value = useXbtDisplayPrice();
  useEffect(() => {
    current = value;
  }, [value]);
  return <Text testID="estimate">{value.xbtPriceQuote ? formatXbtQuoteEstimate(123456789, value.xbtPriceQuote) : 'none'}</Text>;
}
function deferred<T>() {
  let resolveResult!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    resolveResult = resolve;
  });
  return { promise, resolve: resolveResult };
}
function foreground() {
  changed('background');
  changed('active');
}

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  AppState.currentState = 'active';
  remove = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    changed = listener;
    return { remove };
  });
  load.mockResolvedValue(createNeoxexXbtPriceQuote('10', NOW - 60000));
  save.mockResolvedValue(undefined);
  clear.mockResolvedValue(undefined);
  fetchPrice.mockResolvedValue(createNeoxexXbtPriceQuote('20', NOW));
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.resetAllMocks();
  AppState.currentState = initialState;
});

test('launch refresh replaces the cached quote and recalculates the displayed total', async () => {
  const response = deferred<XbtPriceQuote>();
  fetchPrice.mockReturnValue(response.promise);
  const view = render(<Probe />);
  await waitFor(() => expect(fetchPrice).toHaveBeenCalledTimes(1));
  expect(view.getByTestId('estimate')).toHaveTextContent('12.35 USDC');
  await act(async () => response.resolve(createNeoxexXbtPriceQuote('20', NOW)));
  expect(view.getByTestId('estimate')).toHaveTextContent('24.69 USDC');
  expect(save).toHaveBeenCalledWith(createNeoxexXbtPriceQuote('20', NOW));
});

test('returning to the foreground refreshes once without polling or duplicate active events', async () => {
  const view = render(<Probe />);
  await waitFor(() => expect(view.getByTestId('estimate')).toHaveTextContent('24.69 USDC'));
  fetchPrice.mockResolvedValue(createNeoxexXbtPriceQuote('30', NOW));
  await act(async () => {
    foreground();
    changed('active');
  });
  expect(fetchPrice).toHaveBeenCalledTimes(2);
  expect(view.getByTestId('estimate')).toHaveTextContent('37.04 USDC');
  view.unmount();
  expect(remove).toHaveBeenCalledTimes(1);
});

test('a background launch waits for foreground and shares an in-flight refresh', async () => {
  AppState.currentState = 'background';
  const response = deferred<XbtPriceQuote>();
  fetchPrice.mockReturnValue(response.promise);
  render(<Probe />);
  await waitFor(() => expect(current.xbtPriceQuote?.pricePerXbt).toBe('10'));
  expect(fetchPrice).not.toHaveBeenCalled();
  act(() => {
    changed('active');
    foreground();
  });
  expect(fetchPrice).toHaveBeenCalledTimes(1);
  let manualRequest!: Promise<void>;
  act(() => {
    manualRequest = current.refreshNeoxexXbtPriceQuote();
  });
  expect(fetchPrice).toHaveBeenCalledTimes(1);
  await act(async () => {
    response.resolve(createNeoxexXbtPriceQuote('20', NOW));
    await manualRequest;
  });
});

test.each(['manual', 'cleared'])('does not replace a %s price choice on launch or resume', async mode => {
  load.mockResolvedValue(mode === 'manual' ? createManualXbtPriceQuote('7', 'USD') : null);
  render(<Probe />);
  await act(async () => {});
  await act(async () => foreground());
  expect(fetchPrice).not.toHaveBeenCalled();
  expect(save).not.toHaveBeenCalled();
});

test('an exchange failure preserves the last valid quote and actual trade time', async () => {
  fetchPrice.mockRejectedValue(new Error('exchange unavailable'));
  render(<Probe />);
  await waitFor(() => expect(fetchPrice).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(current.xbtPriceQuote).toEqual(createNeoxexXbtPriceQuote('10', NOW - 60000));
  expect(save).not.toHaveBeenCalled();
});

test.each(['manual', 'clear'])('a late market response cannot overwrite a newer %s choice', async action => {
  const response = deferred<XbtPriceQuote>();
  fetchPrice.mockReturnValue(response.promise);
  render(<Probe />);
  await waitFor(() => expect(fetchPrice).toHaveBeenCalledTimes(1));
  await act(async () => {
    if (action === 'manual') await current.saveManualXbtPriceQuote('7', 'USD');
    else await current.clearXbtPriceQuote();
    foreground();
  });
  await act(async () => response.resolve(createNeoxexXbtPriceQuote('20', NOW)));
  expect(current.xbtPriceQuote).toEqual(action === 'manual' ? createManualXbtPriceQuote('7', 'USD') : null);
  expect(fetchPrice).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalledWith(expect.objectContaining({ source: 'neoxex' }));
});

test('slow hydration does not overwrite an explicit manual selection', async () => {
  const hydration = deferred<XbtPriceQuote | null>();
  load.mockReturnValue(hydration.promise);
  render(<Probe />);
  await act(async () => current.saveManualXbtPriceQuote('7', 'USD'));
  await act(async () => hydration.resolve(createNeoxexXbtPriceQuote('10', NOW)));
  expect(current.xbtPriceQuote?.source).toBe('manual');
  expect(fetchPrice).not.toHaveBeenCalled();
});

test('unmount invalidates a pending automatic response before persistence', async () => {
  const response = deferred<XbtPriceQuote>();
  fetchPrice.mockReturnValue(response.promise);
  const view = render(<Probe />);
  await waitFor(() => expect(fetchPrice).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => response.resolve(createNeoxexXbtPriceQuote('20', NOW)));
  expect(save).not.toHaveBeenCalled();
});
