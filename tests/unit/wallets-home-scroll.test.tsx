import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

const mockRefresh = jest.fn(async () => {});
const mockNavigation = { navigate: jest.fn() };
const mockTransactions = Array.from({ length: 20 }, (_, i) => ({ hash: `tx-${i}`, walletID: 'wallet' }));
const mockWallets = [{ getID: () => 'wallet' }, { getID: () => 'second-wallet' }];
const mockMenu = { registerTransactionsHandler: jest.fn(), unregisterTransactionsHandler: jest.fn() };
let mockBtc = false;
let mockXbtSource: 'manual' | 'neoxex' | undefined;
const mockBtcPriceRefresh = jest.fn(async () => {});
const mockXbtPriceRefresh = jest.fn(async () => {});
let mockElectrumDisabled = false;
let mockSkin = 'off';
let mockLarge = false;
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => ({ wallets: mockWallets, getTransactions: () => mockTransactions, refreshAllWalletTransactions: mockRefresh }),
}));
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({
    isTotalBalanceEnabled: true,
    isElectrumDisabled: mockElectrumDisabled,
    xbtPriceQuote: mockXbtSource ? { source: mockXbtSource } : null,
    refreshNeoxexBtcPriceQuote: mockBtcPriceRefresh,
    refreshNeoxexXbtPriceQuote: mockXbtPriceRefresh,
  }),
}));
jest.mock('../../hooks/useMenuElements', () => ({ __esModule: true, default: () => mockMenu }));
jest.mock('../../hooks/useExtendedNavigation', () => ({ useExtendedNavigation: () => mockNavigation }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
  useRoute: () => ({ name: 'WalletsList' }),
  useFocusEffect: () => {},
}));
jest.mock('../../blue_modules/sizeClass', () => ({
  SizeClass: { Compact: 0, Regular: 1, Large: 2 },
  useSizeClass: () => ({ sizeClass: mockLarge ? 2 : 0, isLarge: mockLarge }),
}));
jest.mock('../../blue_modules/artwork-skin', () => ({ useArtworkSkinSelection: () => mockSkin }));
jest.mock('../../blue_modules/wallet-network', () => ({ selectWalletNetwork: jest.fn(), isBtcWallet: () => mockBtc }));
jest.mock('../../blue_modules/fs', () => ({}));
jest.mock('../../class/deeplink-schema-match', () => ({}));
jest.mock('../../helpers/scan-qr', () => ({ scanQrHelper: jest.fn() }));
jest.mock('../../screen/ActionSheet', () => ({}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, left: 0, right: 0, bottom: 34 }) }));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
jest.mock('../../components/TotalWalletsBalance', () => {
  const { Text } = require('react-native');
  return () => <Text testID="HomeTotalBalance">Total balance</Text>;
});
jest.mock('../../components/WalletsCarousel', () => {
  const { ScrollView, Text } = require('react-native');
  return {
    __esModule: true,
    getWalletCarouselItemWidth: () => 320,
    default: React.forwardRef((props: any, _ref) => (
      <ScrollView {...props}>
        <Text>Wallet card</Text>
      </ScrollView>
    )),
  };
});
jest.mock('../../components/TransactionListItem', () => {
  const { Text } = require('react-native');
  return { TransactionListItem: ({ item }: any) => <Text testID={item.hash}>{item.hash}</Text> };
});
const WalletsList = require('../../screen/wallets/WalletsList').default;

beforeEach(() => jest.useFakeTimers());

afterEach(() => {
  act(() => jest.runOnlyPendingTimers());
  jest.useRealTimers();
  mockBtc = false;
  mockXbtSource = undefined;
  mockElectrumDisabled = false;
  mockSkin = 'off';
  mockLarge = false;
  jest.clearAllMocks();
});

test.each(['off', 'helmet', 'armour'])('transaction scrolling leaves the %s dashboard header outside the scroll area', async skin => {
  mockSkin = skin;
  const s = render(<WalletsList />);
  await act(async () => {});
  const list = s.getByTestId('Wallets');
  const header = s.getByTestId('WalletsPinnedHeader');
  expect(within(header).getByTestId('HomeTotalBalance')).toBeTruthy();
  expect(within(header).getByTestId('WalletsList')).toBeTruthy();
  expect(within(list).queryByTestId('HomeTotalBalance')).toBeNull();
  expect(within(list).queryByTestId('WalletsList')).toBeNull();
  expect(within(list).queryByText(/Transactions/)).toBeNull();
  fireEvent.scroll(list, {
    nativeEvent: {
      contentOffset: { x: 0, y: 100 },
      contentSize: { width: 390, height: 1800 },
      layoutMeasurement: { width: 390, height: 240 },
    },
  });
  expect(within(header).getByText('Wallet card')).toBeTruthy();
  expect(s.getByText(/Transactions/)).toBeTruthy();
  expect(StyleSheet.flatten(s.getByTestId('WalletsTransactionViewport').props.style).overflow).toBe('hidden');
  expect(list.props.contentInsetAdjustmentBehavior).toBe('never');
  expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingTop).toBe(0);
  expect(StyleSheet.flatten(list.props.contentContainerStyle).paddingBottom).toBeGreaterThan(34);
  await act(async () => fireEvent(list, 'refresh'));
  expect(mockRefresh).toHaveBeenCalled();
  s.unmount();
});

test('large-screen transaction pane keeps its standalone list', async () => {
  mockLarge = true;
  const s = render(<WalletsList />);
  await act(async () => {});
  expect(s.queryByTestId('WalletsPinnedHeader')).toBeNull();
  expect(s.getByTestId('Wallets')).toBeTruthy();
  s.unmount();
});

test.each(['manual', 'neoxex'] as const)(
  'SHA-256 pull-to-refresh works with XBT disabled and respects the %s XBT quote choice',
  async source => {
    mockBtc = true;
    mockElectrumDisabled = true;
    mockXbtSource = source;
    const view = render(<WalletsList />);
    await act(async () => {});
    await act(async () => fireEvent(view.getByTestId('Wallets'), 'refresh'));
    expect(mockBtcPriceRefresh).toHaveBeenCalledTimes(1);
    expect(mockXbtPriceRefresh).toHaveBeenCalledTimes(source === 'neoxex' ? 1 : 0);
    view.unmount();
  },
);
