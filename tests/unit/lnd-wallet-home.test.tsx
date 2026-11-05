import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NativeModules, View } from 'react-native';
import { LndWallet, LndOverview } from '../../class/wallets/lnd-wallet';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
jest.mock('../../components/XbtFiatEstimate', () => () => null);
const mockNavigation = { navigate: jest.fn(), setOptions: jest.fn() };
const mockStorage = { saveToDisk: jest.fn(async () => {}) };
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => mockStorage,
}));
const overview: LndOverview = {
  node: '02' + 'a'.repeat(64),
  synced: true,
  peers: '1',
  height: '980556',
  activeChannels: '1',
  fundingTotal: '800000',
  fundingConfirmed: '790000',
  fundingPending: '10000',
  fundingLocked: '1000',
  anchorReserve: '2000',
  lightningLocal: '99056',
  lightningRemote: '0',
  channelPending: '0',
  splicePending: '0',
};
const bridge = {
  run: jest.fn(async () => 'Running'),
  wallet: jest.fn(async (kind: string) =>
    kind === 'overview'
      ? overview
      : {
          rows:
            kind === 'funding'
              ? [
                  {
                    id: 'funding-tx',
                    direction: 'received',
                    sats: '1000000',
                    feeSats: '0',
                    timestamp: 1700000000,
                    state: 'pending',
                    memo: '',
                    confirmations: 0,
                  },
                ]
              : kind === 'invoices'
                ? [
                    {
                      id: 'invoice-hash',
                      direction: 'received',
                      sats: '500',
                      feeSats: '0',
                      timestamp: 1700000100,
                      state: 'settled',
                      memo: 'Test payment',
                    },
                  ]
                : [],
          next: '0',
          more: false,
        },
  ),
  invoice: jest.fn(),
  manage: jest.fn(),
};
NativeModules.XBTLightningBridge = bridge;
const LndWalletHome = require('../../screen/wallets/LndWalletHome').default;

beforeEach(() => {
  jest.clearAllMocks();
  bridge.run.mockResolvedValue('Running');
});

test('payment buttons lead; funding is secondary; tab histories use distinct native queries', async () => {
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  expect(screen.getByRole('tab', { name: 'Transactions' }).props.accessibilityState.selected).toBe(true);
  expect(screen.getByText('Test payment')).toBeTruthy();
  expect(screen.queryByText('On-chain deposits and withdrawals')).toBeNull();
  expect(bridge.wallet).toHaveBeenCalledWith('payments', '0');
  expect(bridge.wallet).toHaveBeenCalledWith('invoices', '0');
  expect(bridge.wallet).not.toHaveBeenCalledWith('funding', '0');
  fireEvent.press(screen.getByLabelText('Pay (invoice)'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('XBTLightning', {
    mode: 'pay',
  });
  fireEvent.press(screen.getByLabelText('Receive (create invoice)'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('XBTLightning', {
    mode: 'invoice',
  });
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Funding' })));
  expect(bridge.wallet).toHaveBeenCalledWith('funding', '0');
  expect(screen.getByText(/0 confirmations/)).toBeTruthy();
  expect(screen.queryByText('Test payment')).toBeNull();
  fireEvent.press(screen.getByLabelText('Receive on-chain'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('XBTLightning', {
    mode: 'receive',
  });
  expect(screen.getByLabelText('Pay (invoice)')).toBeTruthy();
  expect(bridge.invoice).not.toHaveBeenCalled();
  expect(bridge.manage).not.toHaveBeenCalled();
  screen.unmount();
});

test('three-dot menu opens the original node tools; connected badge needs fresh peer evidence', async () => {
  const wallet = new LndWallet();
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  expect(screen.getByLabelText('LND · Connected')).toBeTruthy();
  const options = mockNavigation.setOptions.mock.calls.at(-1)![0];
  const menu = render(<View>{options.headerRight()}</View>);
  fireEvent.press(menu.getByLabelText('Lightning wallet settings'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('XBTLightning', {
    mode: undefined,
  });
  menu.unmount();
  screen.unmount();
  expect(wallet.connection()).toBe('disconnected');
});

test('stopped node shows setup path and disables financial actions', async () => {
  bridge.run.mockResolvedValue('Stopped');
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  expect(screen.getByText('Open node settings · Stopped')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Pay (invoice)'));
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  expect(bridge.invoice).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('LND · Connected')).toBeNull();
  screen.unmount();
});
