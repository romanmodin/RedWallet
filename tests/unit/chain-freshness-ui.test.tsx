import React from 'react';
import { AppState, Alert } from 'react-native';
import { render, renderHook, act, fireEvent } from '@testing-library/react-native';
import Indicator, { useChainFreshness } from '../../components/ChainFreshnessIndicator';
import { checkChain } from '../../blue_modules/chain-freshness';
import { ChainStatus } from '../../class/xbt/chain-freshness';
jest.mock('../../blue_modules/chain-freshness', () => ({ checkChain: jest.fn() }));
jest.mock('../../blue_modules/BlueElectrum', () => ({ subscribeConnectionState: jest.fn(() => () => {}) }));

const verified: ChainStatus = {
  state: 'verified',
  serverLabel: 'Fulcrum',
  source: 'mempool.guide',
  height: 977037,
  message: 'Matches public data',
  references: [],
};
let lifecycle: (state: string) => void;
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  Object.defineProperty(AppState, 'currentState', { value: 'active', writable: true, configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    lifecycle = callback as any;
    return { remove: jest.fn() };
  });
  (checkChain as jest.Mock).mockResolvedValue(verified);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it('shows the approved warning without opening an alert until tapped', () => {
  const alert = jest.spyOn(Alert, 'alert');
  const screen = render(<Indicator status={{ ...verified, state: 'behind' }} retry={jest.fn()} />);
  expect(screen.getByText('Your Fulcrum is behind')).toBeTruthy();
  expect(alert).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('ChainFreshnessIndicator'));
  expect(alert).toHaveBeenCalledTimes(1);
});

it('checks on mounting and hourly while active, not every five minutes', async () => {
  const hook = renderHook(() => useChainFreshness(false));
  await act(async () => {});
  expect(checkChain).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(5 * 60 * 1000);
  });
  expect(checkChain).toHaveBeenCalledTimes(1);
  await act(async () => {
    jest.advanceTimersByTime(55 * 60 * 1000);
  });
  expect(checkChain).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it('does not poll in the background and rechecks each foreground opening', async () => {
  const hook = renderHook(() => useChainFreshness(false));
  await act(async () => {});
  await act(async () => {
    AppState.currentState = 'background';
    lifecycle('background');
    jest.advanceTimersByTime(2 * 60 * 60 * 1000);
  });
  expect(checkChain).toHaveBeenCalledTimes(1);
  await act(async () => {
    AppState.currentState = 'active';
    lifecycle('active');
  });
  expect(checkChain).toHaveBeenCalledTimes(2);
  hook.unmount();
});

it('does not start any checks when explicitly offline', async () => {
  const hook = renderHook(() => useChainFreshness(true));
  await act(async () => {
    jest.advanceTimersByTime(60 * 60 * 1000);
  });
  expect(checkChain).not.toHaveBeenCalled();
  hook.unmount();
});

it('discards a response after backgrounding instead of showing stale green', async () => {
  let resolve: (result: ChainStatus) => void = () => {};
  (checkChain as jest.Mock).mockImplementation(
    () =>
      new Promise<ChainStatus>(_resolve => {
        resolve = _resolve;
      }),
  );
  const hook = renderHook(() => useChainFreshness(false));
  await act(async () => {
    AppState.currentState = 'background';
    lifecycle('background');
    resolve(verified);
  });
  expect(hook.result.current.status.state).not.toBe('verified');
  hook.unmount();
});
