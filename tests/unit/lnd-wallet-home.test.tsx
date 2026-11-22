import React from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import Ionicons from '@react-native-vector-icons/ionicons';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import {
  AccessibilityInfo,
  Alert,
  AppState,
  AppStateStatus,
  Dimensions,
  FlatList,
  NativeModules,
  Platform,
  RefreshControl,
  StyleSheet,
  View,
} from 'react-native';
import { LndWallet, LndOverview } from '../../class/wallets/lnd-wallet';
import { bridgeStore } from '../../blue_modules/lightning-bridge/runtime';
import type { BridgeJournal, SwapRecord } from '../../blue_modules/lightning-bridge/state';
import { XbtPriceQuote, createNeoxexXbtPriceQuote } from '../../blue_modules/xbt-price';

jest.mock('../../blue_modules/lightning-bridge/runtime', () => ({
  bridgeStore: { read: jest.fn(), write: jest.fn() },
  crossChainBridge: { history: jest.fn() },
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('@react-navigation/elements', () => ({
  HeaderHeightContext: require('react').createContext(110),
}));
let mockTopInset = 0;
let mockBottomInset = 0;
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: mockTopInset, left: 0, right: 0, bottom: mockBottomInset }),
}));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
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
  bridgePayment: jest.fn(),
};
const defaultWallet = bridge.wallet.getMockImplementation()!;
NativeModules.XBTLightningBridge = bridge;
const LndWalletHome = require('../../screen/wallets/LndWalletHome').default;

beforeEach(() => {
  jest.clearAllMocks();
  mockSettings.xbtPriceQuote = null;
  mockTopInset = 0;
  mockBottomInset = 0;
  jest.mocked(bridgeStore.read).mockResolvedValue({ version: 1, records: [], requests: [] });
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
  expect(screen.queryByTestId('LndBalanceBreakdown')).toBeNull();
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
  expect(screen.getByTestId('LndBalanceBreakdown')).toBeTruthy();
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

test.each([1, 2])('the open tab expands and the two outer corners reveal the wallet header at font scale %s', async fontScale => {
  jest.spyOn(Dimensions, 'get').mockReturnValue({ width: 375, height: 812, scale: 3, fontScale });
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  const tabs = [
    ['Transactions', 'list-outline'],
    ['Cross-chain payments', 'swap-horizontal-outline'],
    ['Funding', 'wallet-outline'],
  ] as const;
  const stripStyle = () => StyleSheet.flatten(screen.getByTestId('LndHistoryTabs').props.style);
  const height = stripStyle().height;
  expect(stripStyle().backgroundColor).toBe('#741B2A');
  const radius = 13.25;
  for (const [selected] of [...tabs, tabs[0]]) {
    await act(async () => fireEvent.press(screen.getByRole('tab', { name: selected })));
    expect(stripStyle().height).toBe(height);
    const inactiveColors = ['#18794E', '#2166A5'];
    const faces = tabs.map(([name, iconName]) => {
      const button = screen.getByRole('tab', { name });
      const style = StyleSheet.flatten(button.props.style);
      const face = StyleSheet.flatten(within(button).getByTestId('LndHistoryTabFace').props.style);
      const active = name === selected;
      expect(button.props.accessibilityState.selected).toBe(active);
      expect(style.width).toBe(active ? '64%' : '18%');
      expect(face.backgroundColor).toBe(active ? '#FFFFFF' : inactiveColors.shift());
      expect(face.borderBottomWidth ?? 0).toBe(0);
      expect(style.borderBottomWidth ?? 0).toBe(0);
      if (active) {
        const label = within(button).getByText(name);
        expect(StyleSheet.flatten(label.props.style)).toMatchObject({ fontSize: 21, fontWeight: '400' });
        expect(label.props).toMatchObject({ numberOfLines: fontScale === 1 ? 1 : 2, adjustsFontSizeToFit: true });
        expect(button.findAllByType(Ionicons)).toHaveLength(0);
      } else {
        expect(within(button).queryByText(name)).toBeNull();
        expect(button.findByType(Ionicons).props).toMatchObject({ name: iconName, color: '#FFFFFF' });
      }
      return { ...face, zIndex: style.zIndex };
    });
    expect(faces[0]).toMatchObject({ left: 0, borderTopLeftRadius: radius });
    expect(faces[2]).toMatchObject({ right: 0, borderTopRightRadius: radius });
    for (const [left, right] of [
      [faces[0], faces[1]],
      [faces[1], faces[2]],
    ]) {
      if (left.zIndex > right.zIndex) {
        expect(left).toMatchObject({ right: 0, borderTopRightRadius: radius });
        expect(right.left).toBe(-radius);
      } else {
        expect(right.zIndex).toBeGreaterThan(left.zIndex);
        expect(right).toMatchObject({ left: 0, borderTopLeftRadius: radius });
        expect(left.right).toBe(-radius);
      }
    }
  }
  screen.unmount();
});

test('the middle tab scopes records and quote attempts to this node and only settled payments show a debit', async () => {
  const wallet = new LndWallet();
  const settledHash = '11'.repeat(32);
  const expiredHash = '22'.repeat(32);
  const now = 1700000000000;
  const record: SwapRecord = {
    hash: settledHash,
    node: overview.node,
    provider: 'fixture',
    state: 'settled',
    feeLimit: '1',
    createdAt: now,
    updatedAt: now,
    quote: {
      provider: 'fixture',
      hash: settledHash,
      original: 'synthetic-original',
      originalMsat: '100000',
      holdInvoice: 'synthetic-hold',
      payMsat: '300000125',
      paySat: '300001',
      rate: 1,
      spread: 0,
      expiresAt: now / 1000 + 60,
      token: '',
      destination: overview.node,
      cltv: 80,
    },
  };
  const otherNode = '03' + 'bb'.repeat(32);
  const issue = { hash: '33'.repeat(32), node: overview.node, provider: 'fixture', at: now + 50, reason: 'proofTimeout' } as const;
  const journal: BridgeJournal = {
    version: 1,
    requests: [],
    records: [record, { ...record, hash: expiredHash, state: 'quote_expired' }, { ...record, node: otherNode }],
    issues: [issue, { ...issue, node: otherNode, hash: '44'.repeat(32) }],
  };
  jest.mocked(bridgeStore.read).mockResolvedValue(journal);
  bridge.wallet.mockImplementation(async kind =>
    kind === 'payments'
      ? {
          rows: [settledHash, expiredHash].map((id, i) => ({
            id,
            direction: 'sent',
            state: 'settled',
            sats: '700',
            feeSats: '0',
            timestamp: now / 1000,
            memo: i ? 'Separate payment' : 'Bridge leg',
          })),
          next: '0',
          more: false,
        }
      : defaultWallet(kind),
  );
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  expect(screen.getByText('Test payment')).toBeTruthy();
  expect(screen.getByText('Separate payment')).toBeTruthy();
  expect(screen.queryByText('Bridge leg')).toBeNull();
  expect(screen.queryByText('XBT → SHA-256')).toBeNull();
  bridge.wallet.mockClear();
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Cross-chain payments' })));
  expect(screen.getAllByText('XBT → SHA-256')).toHaveLength(3);
  expect(screen.getByText(/^Quote expired/)).toBeTruthy();
  expect(screen.getByText(/^Quote request/)).toBeTruthy();
  expect(screen.getAllByText('−300000.125 XBT sats')).toHaveLength(1);
  expect(screen.queryByText('Separate payment')).toBeNull();
  expect(screen.queryByText('Test payment')).toBeNull();
  expect(bridge.wallet.mock.calls.every(([kind]) => kind === 'overview')).toBe(true);
  expect(bridge.bridgePayment).not.toHaveBeenCalled();
  expect(bridgeStore.write).not.toHaveBeenCalled();
  wallet.hideBalance = true;
  screen.rerender(<LndWalletHome wallet={wallet} />);
  expect(screen.queryByText(/300000/)).toBeNull();
  bridge.run.mockResolvedValue('Locked');
  await act(async () => fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh'));
  expect(screen.queryByText('XBT → SHA-256')).toBeNull();
  expect(screen.getByText(/Start or unlock/)).toBeTruthy();
  screen.unmount();
});

test('a running wallet must supply its node identity before activity is read', async () => {
  bridge.wallet.mockImplementation(async kind => (kind === 'overview' ? { ...overview, node: '' } : defaultWallet(kind)));
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  expect(screen.getByText(/Refresh failed/)).toBeTruthy();
  expect(bridge.wallet).not.toHaveBeenCalledWith('payments', '0');
  expect(bridgeStore.read).not.toHaveBeenCalled();
  screen.unmount();
});

test('a failed journal read is distinct from an empty cross-chain history and a pull can recover', async () => {
  jest.mocked(bridgeStore.read).mockRejectedValue(new Error('Synthetic storage read error'));
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Cross-chain payments' })));
  expect(screen.getByText(/history could not be read/)).toBeTruthy();
  jest.mocked(bridgeStore.read).mockResolvedValue({ version: 1, records: [], requests: [] });
  await act(async () => fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh'));
  expect(screen.getByText('No cross-chain payments yet.')).toBeTruthy();
  expect(bridge.bridgePayment).not.toHaveBeenCalled();
  screen.unmount();
});

test('header details start collapsed and keep the balance and history available while toggling', async () => {
  mockSettings.xbtPriceQuote = createNeoxexXbtPriceQuote('300', Date.now());
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  const toggle = screen.getByRole('button', { name: 'Expand Details' });
  expect(toggle.props.accessibilityState.expanded).toBe(false);
  expect(screen.queryByText('XBT Lightning')).toBeNull();
  expect(screen.getByTestId('LndWalletBalance')).toBeTruthy();
  expect(screen.getByLabelText('LND · Connected')).toBeTruthy();
  expect(screen.queryByTestId('XbtPriceEstimate')).toBeNull();
  expect(screen.queryByText(/In channels .*On-chain /)).toBeNull();
  fireEvent.press(toggle);
  expect(screen.getByRole('button', { name: 'Collapse Details' }).props.accessibilityState.expanded).toBe(true);
  expect(screen.getByText(/In channels .*On-chain /)).toBeTruthy();
  expect(screen.getByTestId('XbtPriceEstimate')).toBeTruthy();
  expect(screen.getByText('1 active channel')).toBeTruthy();
  expect(screen.queryByTestId('LndBalanceBreakdown')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Collapse Details' }));
  expect(screen.queryByTestId('XbtPriceEstimate')).toBeNull();
  expect(screen.getByText('Test payment')).toBeTruthy();
  expect(mockNavigation.navigate).not.toHaveBeenCalled();
  screen.unmount();
});

describe('Lightning connection clock', () => {
  const originalAppState = AppState.currentState;
  const name = 'Connecting to Lightning';
  beforeEach(() => {
    jest.useFakeTimers();
    AppState.currentState = 'active';
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  });
  afterEach(() => {
    AppState.currentState = originalAppState;
    jest.useRealTimers();
  });

  test('centers the connection wheel in the balance row without intercepting touches', async () => {
    mockTopInset = 59;
    bridge.run.mockResolvedValue('Tor connecting');
    const screen = render(<LndWalletHome wallet={new LndWallet()} />);
    await act(async () => {});
    const balance = within(screen.getByTestId('LndWalletBalanceRow'));
    const overlay = balance.getByTestId('LndConnectionClockOverlay');
    expect(balance.getByTestId('LndWalletBalance')).toBeTruthy();
    expect(StyleSheet.flatten(overlay.props.style)).toMatchObject({
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      top: 0,
      bottom: 0,
      justifyContent: 'center',
    });
    expect(overlay.props.pointerEvents).toBe('none');
    expect(within(overlay).getByTestId('svg-Svg').props).toMatchObject({ width: 100, height: 100 });
    expect(mockNavigation.setOptions).toHaveBeenCalledWith(expect.objectContaining({ headerTransparent: true }));
    fireEvent.press(screen.getByRole('button', { name: 'Expand Details' }));
    expect(screen.getByRole('button', { name: 'Collapse Details' })).toBeTruthy();
    screen.unmount();
  });

  test('an elapsed estimate keeps waiting for both sync and a peer, and a warm refresh adds no sample', async () => {
    const wallet = new LndWallet();
    wallet.recordConnectionDuration(4000);
    wallet.recordConnectionDuration(4000);
    const record = jest.spyOn(wallet, 'recordConnectionDuration');
    const observed = { ...overview, synced: false };
    bridge.wallet.mockImplementation(async kind => (kind === 'overview' ? observed : defaultWallet(kind)));
    const screen = render(<LndWalletHome wallet={wallet} />);
    await act(async () => {});
    const clock = () => screen.getByRole('progressbar', { name });
    const pull = () => act(async () => fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh'));
    expect(clock().props.accessibilityValue.text).toContain('4 seconds');
    expect(within(clock()).queryByText(/[0-9]/)).toBeNull();
    const reads = bridge.run.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(clock().props.accessibilityValue.text).toContain('longer than your recent average');
    expect(bridge.run).toHaveBeenCalledTimes(reads);
    observed.synced = true;
    observed.peers = '0';
    await pull();
    expect(clock()).toBeTruthy();
    expect(record).not.toHaveBeenCalled();
    observed.peers = '1';
    await pull();
    expect(screen.queryByRole('progressbar', { name })).toBeNull();
    expect(screen.getByLabelText('LND · Connected')).toBeTruthy();
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(5000);
    await pull();
    expect(record).toHaveBeenCalledTimes(1);
    screen.unmount();
  });

  test('shows a stationary ring with Reduce Motion and stops it when the node is locked or unavailable', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
    const timers = jest.spyOn(global, 'setInterval');
    const wallet = new LndWallet();
    const record = jest.spyOn(wallet, 'recordConnectionDuration');
    bridge.run.mockResolvedValue('Tor connecting');
    const screen = render(<LndWalletHome wallet={wallet} />);
    await act(async () => {});
    expect(screen.getByRole('progressbar', { name }).props.accessibilityValue.text).toMatch(/learning/i);
    expect(timers.mock.calls.some(([, delay]) => delay === 500)).toBe(false);
    bridge.run.mockResolvedValue('Locked');
    const pull = () => act(async () => fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh'));
    await pull();
    expect(screen.queryByRole('progressbar', { name })).toBeNull();
    bridge.run.mockResolvedValue('Syncing');
    await pull();
    expect(screen.getByRole('progressbar', { name })).toBeTruthy();
    bridge.run.mockRejectedValueOnce(new Error('Synthetic offline result'));
    await pull();
    expect(screen.queryByRole('progressbar', { name })).toBeNull();
    expect(record).not.toHaveBeenCalled();
    screen.unmount();
  });

  test('saves a successful connection time even when the following history read fails', async () => {
    const wallet = new LndWallet();
    const record = jest.spyOn(wallet, 'recordConnectionDuration');
    bridge.run.mockResolvedValueOnce('Starting');
    const screen = render(<LndWalletHome wallet={wallet} />);
    await act(async () => {});
    expect(screen.getByRole('progressbar', { name }).props.accessibilityValue.text).toMatch(/learning/i);
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    bridge.wallet.mockImplementation(async kind => {
      if (kind === 'payments') throw new Error('Synthetic history read failure');
      return defaultWallet(kind);
    });
    await act(async () => fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh'));
    expect(record).toHaveBeenCalledWith(2000);
    expect(mockStorage.saveToDisk).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('progressbar', { name })).toBeNull();
    expect(screen.getByLabelText('LND · Connected')).toBeTruthy();
    screen.unmount();
  });

  test('background time and a status reply from a previous foreground session never enter the average', async () => {
    const listeners = new Set<(state: AppStateStatus) => void>();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    });
    const changeState = (state: AppStateStatus) =>
      act(async () => {
        AppState.currentState = state;
        listeners.forEach(listener => listener(state));
      });
    const wallet = new LndWallet();
    const record = jest.spyOn(wallet, 'recordConnectionDuration');
    bridge.run.mockResolvedValueOnce('Starting');
    const screen = render(<LndWalletHome wallet={wallet} />);
    await act(async () => {});
    expect(screen.getByRole('progressbar', { name })).toBeTruthy();
    let complete!: (status: string) => void;
    bridge.run.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          complete = resolve;
        }),
    );
    await act(async () => {
      fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
    });
    await changeState('background');
    expect(screen.queryByRole('progressbar', { name })).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(60000);
    });
    await changeState('active');
    await act(async () => complete('Running'));
    expect(screen.getByLabelText('LND · Connected')).toBeTruthy();
    expect(screen.queryByRole('progressbar', { name })).toBeNull();
    expect(record).not.toHaveBeenCalled();
    screen.unmount();
  });
});

test.each([
  [0, 9, 12],
  [21, 10, 13],
  [34, 23, 26],
])('the action bar reserves its own space above a %i-point bottom inset', async (inset, bottomPadding, fundingPadding) => {
  mockBottomInset = inset;
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  const footer = StyleSheet.flatten(screen.getByTestId('LndWalletActions').props.style);
  expect(footer.paddingBottom).toBe(bottomPadding);
  expect(StyleSheet.flatten(screen.getByTestId('LndWalletActionRow').props.style).marginTop).toBe(9);
  expect(footer.position).not.toBe('absolute');
  expect(screen.UNSAFE_getByType(FlatList).props.contentContainerStyle.paddingBottom).toBeLessThan(bottomPadding);
  for (const label of ['Receive (create invoice)', 'Pay (invoice)']) {
    const button = screen.getByRole('button', { name: label });
    const style = StyleSheet.flatten(button.props.style);
    expect(style).toMatchObject({ minHeight: 62, paddingVertical: 9 });
    expect(style.minHeight - Math.max(0, inset - bottomPadding)).toBeGreaterThanOrEqual(50);
  }
  await act(async () => fireEvent.press(screen.getByRole('tab', { name: 'Funding' })));
  expect(StyleSheet.flatten(screen.getByTestId('LndWalletActions').props.style).paddingBottom).toBe(fundingPadding);
  expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Send on-chain' }).props.style).minHeight).toBe(54);
  screen.unmount();
});

test('Android retains the full system navigation inset', async () => {
  const platform = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    mockBottomInset = 34;
    const screen = render(<LndWalletHome wallet={new LndWallet()} />);
    await act(async () => {});
    expect(StyleSheet.flatten(screen.getByTestId('LndWalletActions').props.style).paddingBottom).toBe(34);
    expect(StyleSheet.flatten(screen.getByRole('button', { name: 'Pay (invoice)' }).props.style).minHeight).toBe(68);
    screen.unmount();
  } finally {
    platform.restore();
  }
});

test('navigation shows the wallet name once and the three-dot menu opens node tools', async () => {
  const wallet = new LndWallet().setLabel('Travel Lightning');
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  expect(screen.getByLabelText('LND · Connected')).toBeTruthy();
  const options = mockNavigation.setOptions.mock.calls.at(-1)![0];
  expect(options.title).toBe('Travel Lightning');
  expect(options.headerTitleStyle.fontSize).toBe(19);
  expect(screen.queryByText('Travel Lightning')).toBeNull();
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

test.each([
  [1, 'Routing timed out.'],
  [2, 'No usable route to the recipient.'],
  [3, 'The node reported a payment error.'],
  [4, 'The node reported incorrect payment details.'],
  [5, 'Insufficient spendable Lightning balance for this payment.'],
  [6, 'The payment was canceled.'],
  [undefined, 'No further failure detail is available.'],
  [0, 'No further failure detail is available.'],
  [99, 'No further failure detail is available.'],
] as const)('failed payment receipt displays and copies the recorded reason for code %s', async (failureReasonCode, expected) => {
  bridge.wallet.mockImplementation(async kind =>
    kind === 'payments'
      ? {
          rows: [
            {
              id: 'synthetic-hash',
              direction: 'sent',
              sats: '1500',
              feeSats: '0',
              timestamp: 1700000100,
              state: 'failed',
              memo: '',
              failureReasonCode,
            },
          ],
          next: '0',
          more: false,
        }
      : defaultWallet(kind),
  );
  const alert = jest.spyOn(Alert, 'alert');
  const copy = jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
  const screen = render(<LndWalletHome wallet={new LndWallet()} />);
  await act(async () => {});
  fireEvent.press(screen.getByLabelText('Sent · failed'));
  const [, receipt, buttons] = alert.mock.calls.at(-1)!;
  expect(receipt).toContain(expected);
  buttons!.find(button => button.text === 'Copy details')!.onPress!();
  expect(copy).toHaveBeenCalledWith(receipt);
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
  expect(screen.getByText('Invoice · Awaiting payment')).toBeTruthy();
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

test('ordinary settled rows show direction beside the amount and honor hidden balances for VoiceOver', async () => {
  bridge.wallet.mockImplementation(async kind => {
    if (kind !== 'payments') return defaultWallet(kind);
    return {
      rows: [
        { id: 'outgoing', direction: 'sent', state: 'settled', sats: '700', feeSats: '0', timestamp: 1700000200, memo: 'Sample send' },
      ],
      next: '0',
      more: false,
    };
  });
  const wallet = new LndWallet();
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  const received = screen.getByRole('button', { name: 'Received · settled' });
  const sent = screen.getByRole('button', { name: 'Sent · settled' });
  expect(within(received).getByText('↙')).toBeTruthy();
  expect(within(sent).getByText('↗')).toBeTruthy();
  expect(screen.queryByText('↙ Received')).toBeNull();
  expect(screen.queryByText('↗ Payment')).toBeNull();
  expect(received.props.accessibilityValue.text).toBe('+0.000005 XBT');
  expect(sent.props.accessibilityValue.text).toBe('−0.000007 XBT');
  wallet.hideBalance = true;
  screen.rerender(<LndWalletHome wallet={wallet} />);
  expect(screen.getByLabelText('Sent · settled').props.accessibilityValue.text).toBe('Amount hidden');
  expect(screen.queryByText('Sample send')).toBeNull();
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
  fireEvent.press(screen.getByRole('button', { name: 'Expand Details' }));
  expect(screen.getByTestId('XbtPriceEstimate')).toBeTruthy();
  await act(async () => toggle());
  expect(balance()).toBe('••••');
  expect(screen.queryByTestId('XbtPriceEstimate')).toBeNull();
  expect(screen.queryByText(/In channels .*On-chain /)).toBeNull();
  expect(screen.queryByText(/USDC confirmed/)).toBeNull();
  expect(screen.queryByText('+≈ 6.00 USDC')).toBeNull();
  expect(screen.getByLabelText('Change wallet display unit').props.accessibilityValue.text).toBe('Amounts hidden');
  const restored = LndWallet.fromJson(JSON.stringify(wallet));
  expect(restored.hideBalance).toBe(true);
  expect(restored.getBalance()).toBe(wallet.getBalance());
  await act(async () => toggle());
  expect(wallet.hideBalance).toBe(false);
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
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('••••');
  await act(async () => fireEvent.press(screen.getByLabelText('Change wallet display unit')));
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('0.00899056 XBT');
  screen.unmount();
});

test('a restored hidden preference masks amounts until the user taps to reveal XBT', async () => {
  const wallet = new LndWallet();
  wallet.hideBalance = true;
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('••••');
  expect(screen.queryByText('+0.000005 XBT')).toBeNull();
  await act(async () => fireEvent.press(screen.getByLabelText('Change wallet display unit')));
  expect(wallet.hideBalance).toBe(false);
  expect(wallet.getDisplayUnit()).toBe('XBT');
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('0.00899056 XBT');
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

test('a failed save keeps a previously hidden wallet hidden', async () => {
  const wallet = new LndWallet();
  wallet.setDisplayUnit('quote');
  wallet.hideBalance = true;
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  mockStorage.saveToDisk.mockRejectedValueOnce(new Error('Storage unavailable'));
  await act(async () => fireEvent.press(screen.getByLabelText('Change wallet display unit')));
  expect(wallet.hideBalance).toBe(true);
  expect(wallet.getDisplayUnit()).toBe('quote');
  expect(screen.getByTestId('LndWalletBalance').props.children).toBe('••••');
  expect(screen.queryByText('+0.000005 XBT')).toBeNull();
  screen.unmount();
});

test.each(['Running', 'Stopped'])('repeated %s polls leave native pull-to-refresh and empty-list layout idle', async status => {
  bridge.run.mockResolvedValue(status);
  bridge.wallet.mockImplementation(async kind => (kind === 'overview' ? overview : { rows: [], next: '0', more: false }));
  const interval = jest.spyOn(global, 'setInterval');
  const wallet = new LndWallet();
  wallet.overview = { ...overview };
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  const poll = interval.mock.calls.find(([, delay]) => delay === 15000)![0] as () => void;
  const list = screen.UNSAFE_getByType(FlatList);
  const emptyText = 'Lightning payments and invoices will appear here.';
  let finishBalance!: () => void;
  const balanceFetch = jest.spyOn(wallet, 'fetchBalance').mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finishBalance = resolve;
      }),
  );
  for (let index = 0; index < 3; index++) {
    await act(async () => {
      poll();
    });
    expect(balanceFetch).toHaveBeenCalledTimes(index + 1);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(screen.getByText(emptyText)).toBeTruthy();
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(StyleSheet.flatten(screen.getByTestId('LndRefreshStatus').props.style).height).toBe(20);
    await act(async () => finishBalance());
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    expect(screen.getByText(emptyText)).toBeTruthy();
    expect(screen.UNSAFE_getByType(FlatList)).toBe(list);
    expect(StyleSheet.flatten(screen.getByTestId('LndRefreshStatus').props.style).height).toBe(20);
  }
  expect(bridge.manage).not.toHaveBeenCalled();
  expect(bridge.invoice).not.toHaveBeenCalled();
  screen.unmount();
});

test.each([false, true])('only a manual pull starts the native refresh indicator and clears it (failure: %s)', async failure => {
  const wallet = new LndWallet();
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  let finishBalance!: () => void;
  jest.spyOn(wallet, 'fetchBalance').mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        finishBalance = () => (failure ? reject(new Error('Offline')) : resolve());
      }),
  );
  expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  await act(async () => {
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  });
  expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);
  await act(async () => finishBalance());
  expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
  if (failure) expect(screen.getByText('Refresh failed. Showing last known data. Pull down to retry.')).toBeTruthy();
  screen.unmount();
});

test('keeps a queued pull visible through the refresh requested during a poll', async () => {
  const interval = jest.spyOn(global, 'setInterval');
  const wallet = new LndWallet();
  const screen = render(<LndWalletHome wallet={wallet} />);
  await act(async () => {});
  const poll = interval.mock.calls.find(([, delay]) => delay === 15000)![0] as () => void;
  const finishBalance: (() => void)[] = [];
  const balanceFetch = jest.spyOn(wallet, 'fetchBalance').mockImplementation(
    () =>
      new Promise<void>(resolve => {
        finishBalance.push(resolve);
      }),
  );
  const control = () => screen.UNSAFE_getByType(RefreshControl);
  await act(async () => {
    poll();
  });
  expect(control().props.refreshing).toBe(false);
  await act(async () => {
    fireEvent(control(), 'refresh');
    poll();
  });
  expect(balanceFetch).toHaveBeenCalledTimes(1);
  expect(control().props.refreshing).toBe(true);
  await act(async () => finishBalance[0]());
  expect(balanceFetch).toHaveBeenCalledTimes(2);
  expect(control().props.refreshing).toBe(true);
  await act(async () => finishBalance[1]());
  expect(control().props.refreshing).toBe(false);
  screen.unmount();
});
