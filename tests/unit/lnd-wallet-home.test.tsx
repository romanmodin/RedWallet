import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, NativeModules, View } from 'react-native';
import { LndWallet, LndOverview } from '../../class/wallets/lnd-wallet';
import { XbtPriceQuote, createNeoxexXbtPriceQuote } from '../../blue_modules/xbt-price';

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
const mockSettings: { xbtPriceQuote: XbtPriceQuote | null } = {
  xbtPriceQuote: null,
};
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => mockSettings,
}));
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
const defaultWallet = bridge.wallet.getMockImplementation()!;
NativeModules.XBTLightningBridge = bridge;
const LndWalletHome = require('../../screen/wallets/LndWalletHome').default;

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.xbtPriceQuote = null;
  bridge.run.mockResolvedValue('Running');
  bridge.wallet.mockImplementation(defaultWallet);
  bridge.invoice.mockReset();
  jest.restoreAllMocks();
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
  expect(screen.queryByLabelText('Pay (invoice)')).toBeNull();
  expect(screen.queryByLabelText('Receive (create invoice)')).toBeNull();
  expect(screen.getAllByLabelText('Receive on-chain')).toHaveLength(1);
  fireEvent.press(screen.getByLabelText('Send on-chain'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('XBTLightning', {
    mode: 'send',
  });
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Transactions' })));
  expect(screen.getByLabelText('Pay (invoice)')).toBeTruthy();
  expect(screen.queryByLabelText('Receive on-chain')).toBeNull();
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

test('receive uses a large label and separate subtitle', async () => {
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  expect(screen.getByText('RECEIVE')).toBeTruthy();
  expect(screen.getByText('Create invoice')).toBeTruthy();
  screen.unmount();
});

test('unpaid invoice cancellation requires confirmation and uses its exact hash', async () => {
  let state = 'unpaid';
  bridge.wallet.mockImplementation(async (kind: string) =>
    kind === 'invoices'
      ? {
          rows: [
            {
              id: 'ab'.repeat(32),
              direction: 'received',
              sats: '500',
              feeSats: '0',
              timestamp: 1700000100,
              state,
              memo: '',
            },
          ],
          next: '0',
          more: false,
        }
      : defaultWallet(kind),
  );
  const alert = jest.spyOn(Alert, 'alert');
  let finish: (value: boolean) => void = () => {};
  bridge.invoice.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Received · unpaid'));
  const cancel = alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Cancel invoice')!;
  expect(bridge.invoice).not.toHaveBeenCalled();
  act(() => cancel.onPress!());
  const confirm = alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Cancel invoice')!;
  await act(async () => {
    confirm.onPress!();
    confirm.onPress!();
  });
  expect(bridge.invoice).toHaveBeenCalledTimes(1);
  expect(bridge.invoice).toHaveBeenCalledWith('cancel', '', 'ab'.repeat(32), '');
  state = 'canceled';
  await act(async () => finish(true));
  expect(screen.getByLabelText('Canceled invoices · 1')).toBeTruthy();
  expect(alert).toHaveBeenCalledWith('Invoice canceled', expect.any(String));
  screen.unmount();
});

test('settled invoices do not offer cancellation', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Received · settled'));
  expect(alert.mock.calls.at(-1)![2]!.some(button => button.text === 'Cancel invoice')).toBe(false);
  screen.unmount();
});

test('failed cancellation refreshes settlement without claiming it was canceled', async () => {
  let state = 'unpaid';
  bridge.wallet.mockImplementation(async (kind: string) =>
    kind === 'invoices'
      ? {
          rows: [
            {
              id: 'cd'.repeat(32),
              direction: 'received',
              sats: '500',
              feeSats: '0',
              timestamp: 1700000100,
              state,
              memo: '',
            },
          ],
          next: '0',
          more: false,
        }
      : defaultWallet(kind),
  );
  bridge.invoice.mockImplementation(async () => {
    state = 'settled';
    throw new Error('Invoice already settled');
  });
  const alert = jest.spyOn(Alert, 'alert');
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Received · unpaid'));
  act(() => alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Cancel invoice')!.onPress!());
  const confirm = alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Cancel invoice')!;
  await act(async () => confirm.onPress!());
  expect(alert).toHaveBeenCalledWith('Cancellation not confirmed', expect.stringContaining('already settled'));
  expect(alert).not.toHaveBeenCalledWith('Invoice canceled', expect.any(String));
  expect(screen.getByLabelText('Received · settled')).toBeTruthy();
  screen.unmount();
});

test('canceled invoices collapse to the newest gray stack and can expand without hiding settled payments', async () => {
  bridge.wallet.mockImplementation(async (kind: string) =>
    kind === 'invoices'
      ? {
          rows: [
            {
              id: 'old',
              direction: 'received',
              sats: '100',
              feeSats: '0',
              timestamp: 100,
              state: 'canceled',
              memo: 'Old canceled',
            },
            {
              id: 'paid',
              direction: 'received',
              sats: '200',
              feeSats: '0',
              timestamp: 200,
              state: 'settled',
              memo: 'Paid invoice',
            },
            {
              id: 'new',
              direction: 'received',
              sats: '300',
              feeSats: '0',
              timestamp: 300,
              state: 'canceled',
              memo: 'New canceled',
            },
          ],
          next: '0',
          more: false,
        }
      : defaultWallet(kind),
  );
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  const stack = screen.getByLabelText('Canceled invoices · 2');
  expect(stack.props.accessibilityState.expanded).toBe(false);
  expect(screen.getByText(/Latest: 0.000003 XBT/)).toBeTruthy();
  expect(screen.queryByText('Old canceled')).toBeNull();
  expect(screen.getByText('Paid invoice')).toBeTruthy();
  fireEvent.press(stack);
  expect(screen.getByText('Old canceled')).toBeTruthy();
  expect(screen.getByText('New canceled')).toBeTruthy();
  expect(screen.queryByText('+100 sats')).toBeNull();
  const alert = jest.spyOn(Alert, 'alert');
  fireEvent.press(screen.getByText('Old canceled'));
  expect(alert).toHaveBeenCalledWith('Lightning payment', expect.stringContaining('old'), expect.any(Array));
  fireEvent.press(screen.getByLabelText('Canceled invoices · 2'));
  expect(screen.queryByText('Old canceled')).toBeNull();
  expect(screen.getByText('Paid invoice')).toBeTruthy();
  screen.unmount();
});

test('balance tap cycles all wallet amounts through XBT, sats and the NeoxEX USDC quote and remembers the choice', async () => {
  mockSettings.xbtPriceQuote = createNeoxexXbtPriceQuote('300', Date.now());
  const wallet = new LndWallet();
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  const balance = () => screen.getByTestId('LndWalletBalance').props.children;
  const toggle = () => fireEvent.press(screen.getByLabelText('Change wallet display unit'));
  expect(balance()).toBe('0.00899056 XBT');
  expect(screen.getByText('+0.000005 XBT')).toBeTruthy();
  await act(async () => toggle());
  expect(balance()).toBe('899,056 sats');
  expect(screen.getByText('+500 sats')).toBeTruthy();
  await act(async () => toggle());
  expect(balance()).toBe('≈ 2.70 USDC');
  expect(screen.getByText('+≈ <0.01 USDC')).toBeTruthy();
  const alert = jest.spyOn(Alert, 'alert');
  fireEvent.press(screen.getByLabelText('Received · settled'));
  expect(alert.mock.calls.at(-1)![1]).toContain('≈ <0.01 USDC (500 sats)');
  expect(mockStorage.saveToDisk).toHaveBeenCalled();
  expect(LndWallet.fromJson(JSON.stringify(wallet)).getDisplayUnit()).toBe('quote');
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Funding' })));
  expect(screen.getByText('+≈ 3.00 USDC')).toBeTruthy();
  expect(screen.getByText('≈ 2.37 USDC confirmed · ≈ 0.03 USDC unconfirmed')).toBeTruthy();
  mockSettings.xbtPriceQuote = createNeoxexXbtPriceQuote('600', Date.now());
  screen.rerender(<LndWalletHome wallet={wallet} />);
  expect(balance()).toBe('≈ 5.39 USDC');
  await act(async () => toggle());
  expect(balance()).toBe('0.00899056 XBT');
  expect(wallet.getBalance()).toBe(899056);
  expect(bridge.invoice).not.toHaveBeenCalled();
  expect(bridge.manage).not.toHaveBeenCalled();
  screen.unmount();
});

test('restored quote mode labels NeoxEX USDC accurately and handles a missing rate without a false zero', async () => {
  const wallet = LndWallet.fromJson(JSON.stringify({ displayUnit: 'quote' }));
  mockSettings.xbtPriceQuote = createNeoxexXbtPriceQuote('300', Date.now());
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('≈ 2.70 USDC');
  mockSettings.xbtPriceQuote = null;
  screen.rerender(<LndWalletHome wallet={wallet} />);
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('Rate unavailable');
  await act(async () => fireEvent.press(screen.getByLabelText('Change wallet display unit')));
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('0.00899056 XBT');
  screen.unmount();
});

test('hidden balances stay hidden and cannot change display units by tapping', async () => {
  const wallet = new LndWallet();
  wallet.hideBalance = true;
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Change wallet display unit'));
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('••••');
  expect(wallet.getDisplayUnit()).toBe('XBT');
  expect(screen.queryByText('+0.000005 XBT')).toBeNull();
  screen.unmount();
});

test('failed preference save restores the previous unit', async () => {
  const wallet = new LndWallet();
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  const alert = jest.spyOn(Alert, 'alert');
  mockStorage.saveToDisk.mockRejectedValueOnce(new Error('Storage unavailable'));
  await act(async () => fireEvent.press(screen.getByLabelText('Change wallet display unit')));
  expect(wallet.getDisplayUnit()).toBe('XBT');
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('0.00899056 XBT');
  expect(alert).toHaveBeenCalledWith('Unit not saved', expect.any(String));
  screen.unmount();
});
