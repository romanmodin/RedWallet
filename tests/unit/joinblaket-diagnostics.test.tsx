import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { AppState, NativeModules, Platform } from 'react-native';
import JoinBlaketDiagnostics from '../../screen/settings/JoinBlaketDiagnostics';
import { probeDirectory } from '../../class/joinblaket/directory-probe';

jest.mock('../../class/joinblaket/directory-probe', () => ({
  probeDirectory: jest.fn(),
  DirectoryProbeError: class extends Error {},
}));
jest.mock('../../components/BlueText', () => require('react-native').Text);
jest.mock('../../components/Button', () => {
  const { createElement } = require('react');
  const { Pressable, Text } = require('react-native');
  return (props: any) => createElement(Pressable, props, createElement(Text, null, props.title));
});
function pending() {
  let resolveValue!: (value: any) => void;
  const promise = new Promise(resolve => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}
let change: (state: string) => void;
const remove = jest.fn();
beforeEach(() => {
  Object.defineProperty(Platform, 'OS', { configurable: true, value: 'ios' });
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  NativeModules.XBTLightningBridge = { joinblaket: jest.fn() };
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, callback) => {
    change = callback as (state: string) => void;
    return { remove };
  });
  remove.mockReset();
  (probeDirectory as jest.Mock).mockReset();
});
afterEach(() => {
  jest.restoreAllMocks();
});

it('never opens a connection on mount and hides the diagnostic without native support', () => {
  const screen = render(<JoinBlaketDiagnostics />);
  expect(probeDirectory).not.toHaveBeenCalled();
  expect(screen.getByTestId('JoinBlaketProbeStart')).toBeTruthy();
  screen.unmount();
  NativeModules.XBTLightningBridge = undefined;
  const unavailable = render(<JoinBlaketDiagnostics />);
  expect(unavailable.queryByTestId('JoinBlaketProbeStart')).toBeNull();
});

it('prevents duplicate starts, cancels on background and rejects a late success', async () => {
  const operation = pending();
  (probeDirectory as jest.Mock).mockReturnValue(operation.promise);
  const screen = render(<JoinBlaketDiagnostics />);
  fireEvent.press(screen.getByTestId('JoinBlaketProbeStart'));
  fireEvent.press(screen.getByTestId('JoinBlaketProbeStart'));
  expect(probeDirectory).toHaveBeenCalledTimes(1);
  const { signal } = (probeDirectory as jest.Mock).mock.calls[0][0];
  act(() => change('background'));
  expect(signal.aborted).toBe(true);
  await act(async () => {
    operation.resolve({ certifiedOffers: 2, makers: 1 });
  });
  expect(screen.queryByText(/Tor authentication passed/)).toBeNull();
});

it('cancels when the user leaves and removes the AppState listener', async () => {
  const operation = pending();
  (probeDirectory as jest.Mock).mockReturnValue(operation.promise);
  const screen = render(<JoinBlaketDiagnostics />);
  fireEvent.press(screen.getByTestId('JoinBlaketProbeStart'));
  const { signal } = (probeDirectory as jest.Mock).mock.calls[0][0];
  screen.unmount();
  expect(signal.aborted).toBe(true);
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => {
    operation.resolve({ certifiedOffers: 2, makers: 1 });
  });
});

it('allows manual cancellation and blocks a start while inactive', async () => {
  const operation = pending();
  (probeDirectory as jest.Mock).mockReturnValue(operation.promise);
  const screen = render(<JoinBlaketDiagnostics />);
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'background' });
  fireEvent.press(screen.getByTestId('JoinBlaketProbeStart'));
  expect(probeDirectory).not.toHaveBeenCalled();
  Object.defineProperty(AppState, 'currentState', { configurable: true, value: 'active' });
  fireEvent.press(screen.getByTestId('JoinBlaketProbeStart'));
  fireEvent.press(screen.getByTestId('JoinBlaketProbeCancel'));
  expect((probeDirectory as jest.Mock).mock.calls[0][0].signal.aborted).toBe(true);
  await act(async () => {
    operation.resolve({ certifiedOffers: 2, makers: 1 });
  });
});

it('shows the authenticated count with the bond-verification limitation', async () => {
  (probeDirectory as jest.Mock).mockResolvedValue({ certifiedOffers: 4, makers: 2 });
  const screen = render(<JoinBlaketDiagnostics />);
  fireEvent.press(screen.getByTestId('JoinBlaketProbeStart'));
  await waitFor(() => expect(screen.getByText('Tor authentication passed. Certified offers: 4. Makers: 2.')).toBeTruthy());
  expect(screen.getByText('Bond and coin checks are not included. Payments remain unavailable.')).toBeTruthy();
});
