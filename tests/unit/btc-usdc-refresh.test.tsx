import React, { useEffect } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react-native';
import { AppState, AppStateStatus, Text } from 'react-native';
import { useBtcDisplayPrice } from '../../hooks/useBtcDisplayPrice';
import { fetchNeoxexBtcPrice } from '../../blue_modules/neoxex-price';
import {
  createNeoxexBtcUsdcPriceQuote,
  BtcUsdcPriceQuote,
  loadBtcUsdcPriceQuote,
  saveBtcUsdcPriceQuote,
} from '../../blue_modules/btc-usdc-price';

jest.mock('../../blue_modules/neoxex-price', () => ({ fetchNeoxexBtcPrice: jest.fn() }));
jest.mock('../../blue_modules/btc-usdc-price', () => ({
  ...jest.requireActual('../../blue_modules/btc-usdc-price'),
  loadBtcUsdcPriceQuote: jest.fn(),
  saveBtcUsdcPriceQuote: jest.fn(),
}));
const load = jest.mocked(loadBtcUsdcPriceQuote);
const save = jest.mocked(saveBtcUsdcPriceQuote);
const fetchPrice = jest.mocked(fetchNeoxexBtcPrice);
const NOW = Date.parse('2026-11-10T12:45:00Z');
const initialState = AppState.currentState;
let changed: (state: AppStateStatus) => void;
let current: ReturnType<typeof useBtcDisplayPrice>;
function Probe({ enabled = true }: { enabled?: boolean }) {
  const q = useBtcDisplayPrice(enabled);
  useEffect(() => {
    current = q;
  }, [q]);
  return <Text testID="quote">{q.btcUsdcPriceQuote?.pricePerBtc ?? 'none'}</Text>;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(_resolve => {
    resolve = _resolve;
  });
  return { promise, resolve };
}
function foreground() {
  changed('background');
  changed('active');
}
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  AppState.currentState = 'active';
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    changed = listener;
    return { remove: jest.fn() };
  });
  load.mockResolvedValue(createNeoxexBtcUsdcPriceQuote('50000', NOW - 60000));
  save.mockResolvedValue(undefined);
  fetchPrice.mockResolvedValue(createNeoxexBtcUsdcPriceQuote('60000', NOW));
});
afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  jest.resetAllMocks();
  AppState.currentState = initialState;
});

test('loads and refreshes only after a SHA-256 wallet exists', async () => {
  const view = render(<Probe enabled={false} />);
  await act(async () => {
    foreground();
  });
  expect(load).not.toHaveBeenCalled();
  expect(fetchPrice).not.toHaveBeenCalled();
  view.rerender(<Probe />);
  await waitFor(() => expect(view.getByTestId('quote')).toHaveTextContent('60000'));
  expect(fetchPrice).toHaveBeenCalledTimes(1);
});
test('shares an in-flight launch/foreground/manual refresh and refreshes once on the next return', async () => {
  const response = deferred<BtcUsdcPriceQuote>();
  fetchPrice.mockReturnValue(response.promise);
  const view = render(<Probe />);
  await waitFor(() => expect(fetchPrice).toHaveBeenCalledTimes(1));
  act(() => {
    foreground();
    foreground();
    current.refreshNeoxexBtcPriceQuote();
  });
  expect(fetchPrice).toHaveBeenCalledTimes(1);
  await act(async () => {
    response.resolve(createNeoxexBtcUsdcPriceQuote('60000', NOW));
  });
  expect(view.getByTestId('quote')).toHaveTextContent('60000');
  await act(async () => {
    foreground();
    changed('active');
  });
  expect(fetchPrice).toHaveBeenCalledTimes(2);
});
test('background launch defers networking until foreground', async () => {
  AppState.currentState = 'background';
  const view = render(<Probe />);
  await waitFor(() => expect(view.getByTestId('quote')).toHaveTextContent('50000'));
  expect(fetchPrice).not.toHaveBeenCalled();
  await act(async () => {
    changed('active');
  });
  expect(fetchPrice).toHaveBeenCalledTimes(1);
});
test('exchange failure retains the cached amount and actual old trade timestamp', async () => {
  fetchPrice.mockRejectedValue(new Error('offline'));
  const view = render(<Probe />);
  await waitFor(() => expect(fetchPrice).toHaveBeenCalledTimes(1));
  expect(view.getByTestId('quote')).toHaveTextContent('50000');
  expect(current.btcUsdcPriceQuote?.updatedAt).toBe(NOW - 60000);
  expect(save).not.toHaveBeenCalled();
});
test.each(['disable', 'unmount'])('ignores a late response after %s', async action => {
  const response = deferred<BtcUsdcPriceQuote>();
  fetchPrice.mockReturnValue(response.promise);
  const view = render(<Probe />);
  await waitFor(() => expect(fetchPrice).toHaveBeenCalledTimes(1));
  if (action === 'disable') view.rerender(<Probe enabled={false} />);
  else view.unmount();
  await act(async () => {
    response.resolve(createNeoxexBtcUsdcPriceQuote('60000', NOW));
  });
  expect(save).not.toHaveBeenCalled();
});
test('a late cache read cannot replace a newer explicit refresh or trigger a duplicate request', async () => {
  const stored = deferred<BtcUsdcPriceQuote | null>();
  load.mockReturnValue(stored.promise);
  const view = render(<Probe />);
  await act(async () => {
    await current.refreshNeoxexBtcPriceQuote();
  });
  expect(view.getByTestId('quote')).toHaveTextContent('60000');
  await act(async () => {
    stored.resolve(createNeoxexBtcUsdcPriceQuote('50000', NOW - 60000));
  });
  expect(view.getByTestId('quote')).toHaveTextContent('60000');
  expect(fetchPrice).toHaveBeenCalledTimes(1);
});
