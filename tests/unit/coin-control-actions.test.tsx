import React from 'react';
import { act, fireEvent, render, cleanup } from '@testing-library/react-native';
import CoinControl from '../../screen/send/CoinControl';
import CoinControlOutputSheet from '../../screen/send/CoinControlOutputSheet';
import { goFromCoinControlToSendDetails } from '../../navigation/goFromCoinControlToSendDetails';
import presentAlert from '../../components/Alert';
import loc from '../../loc';

const mockCoins = [
  { txid: 'aa'.repeat(32), vout: 0, value: 10000, height: 1, address: 'first' },
  {
    txid: 'bb'.repeat(32),
    vout: 0,
    value: 20000,
    height: 2,
    address: 'second',
  },
];
let mockMetadata: Record<string, { frozen?: boolean; memo?: string }> = {};
let mockAvailable = true;
const mockWallet = {
  type: 'xbtSegwitBech32',
  getID: () => 'wallet',
  fetchUtxo: jest.fn(async () => {}),
  getUtxo: (includeFrozen = false) => (mockAvailable ? mockCoins.filter(coin => includeFrozen || !mockMetadata[coin.txid]?.frozen) : []),
  getUTXOMetadata: (txid: string) => mockMetadata[txid] || {},
  setUTXOMetadata: jest.fn((txid: string, _vout: number, meta: object) => {
    mockMetadata[txid] = { ...mockMetadata[txid], ...meta };
  }),
  addressIsChange: () => false,
  getPreferredBalanceUnit: () => 'BTC',
};
const mockSave = jest.fn(async () => {});
const mockSleep = () => new Promise(() => {});
const mockNavigation = {
  setParams: jest.fn(),
  setOptions: jest.fn(),
  navigate: jest.fn(),
  goBack: jest.fn(),
};
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => ({
    wallets: [mockWallet],
    saveToDisk: mockSave,
    sleep: mockSleep,
    txMetadata: {},
  }),
}));
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: { walletID: 'wallet', utxo: mockCoins[0] } }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../components/themes', () => ({
  useTheme: () => ({ colors: {} }),
}));
jest.mock('../../hooks/useKeyboard', () => ({
  useKeyboard: () => ({ isVisible: false }),
}));
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../navigation/goFromCoinControlToSendDetails', () => ({
  goFromCoinControlToSendDetails: jest.fn(),
}));
jest.mock('../../blue_modules/wallet-network', () => ({
  formatWalletBalance: (_wallet: unknown, value: number) => String(value),
}));
jest.mock('../../components/Avatar', () => {
  const { Pressable } = require('react-native');
  return ({ onPress }: any) => <Pressable testID="SelectCoin" onPress={onPress} />;
});
jest.mock('../../components/Badge', () => () => null);
jest.mock('../../components/Icon', () => () => null);
jest.mock('../../components/SafeArea', () => require('react-native').View);
jest.mock('../../components/SafeAreaScrollView', () => require('react-native').View);
jest.mock('../../components/ListItem', () => {
  const { Switch } = require('react-native');
  return (props: any) => <Switch {...props.switch} />;
});
jest.mock('../../components/HeaderRightButton', () => () => null);
jest.mock('../../components/Button', () => {
  const { Pressable, Text } = require('react-native');
  return ({ title, ...props }: any) => (
    <Pressable {...props}>
      <Text>{title}</Text>
    </Pressable>
  );
});
jest.mock('../../components/FloatButtons', () => {
  const { Pressable, Text, View } = require('react-native');
  return {
    FContainer: View,
    FButton: ({ text, onPress }: any) => (
      <Pressable onPress={onPress}>
        <Text>{text}</Text>
      </Pressable>
    ),
  };
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockMetadata = {};
  mockAvailable = true;
});
afterEach(() => {
  cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('mass freeze takes effect immediately and never overwrites another output frozen elsewhere', async () => {
  const screen = render(<CoinControl />);
  await act(async () => {});
  fireEvent.press(screen.getAllByTestId('SelectCoin')[0]);
  mockMetadata[mockCoins[1].txid] = {
    frozen: true,
    memo: 'Recovered CoinJoin change',
  };
  fireEvent.press(screen.getByText(loc.cc.freezeLabel));
  expect(mockMetadata[mockCoins[0].txid].frozen).toBe(true); // Before any timer or disk await.
  await act(async () => fireEvent.press(screen.getByText(loc.cc.use_coin)));
  expect(goFromCoinControlToSendDetails).not.toHaveBeenCalled();
  expect(presentAlert).toHaveBeenCalledWith({
    message: expect.stringContaining('frozen'),
  });
  await act(async () => jest.advanceTimersByTime(1000));
  expect(mockMetadata[mockCoins[1].txid]).toEqual({
    frozen: true,
    memo: 'Recovered CoinJoin change',
  });
  await act(async () => fireEvent.press(screen.getByText(loc.cc.freezeLabel_un)));
  await act(async () => fireEvent.press(screen.getByText(loc.cc.use_coin)));
  expect(goFromCoinControlToSendDetails).toHaveBeenCalledWith(mockNavigation, 'wallet', [mockCoins[0]]);
});

test('the output sheet cannot use a coin frozen just before submission', async () => {
  const screen = render(<CoinControlOutputSheet />);
  await act(async () => {});
  fireEvent(screen.getByTestId('FreezeSwitch'), 'valueChange', true);
  await act(async () => fireEvent.press(screen.getByTestId('UseCoin')));
  expect(goFromCoinControlToSendDetails).not.toHaveBeenCalled();
  expect(presentAlert).toHaveBeenCalledWith({
    message: expect.stringContaining('frozen'),
  });
});

test('the output sheet rechecks availability after persistence completes', async () => {
  const screen = render(<CoinControlOutputSheet />);
  await act(async () => {});
  let saved!: () => void;
  mockSave.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        saved = resolve;
      }),
  );
  fireEvent.press(screen.getByTestId('UseCoin'));
  mockAvailable = false; // A round reserved the coin while persistence was in flight.
  await act(async () => saved());
  expect(goFromCoinControlToSendDetails).not.toHaveBeenCalled();
  expect(presentAlert).toHaveBeenCalledWith({
    message: expect.stringContaining('reserved'),
  });
});

test('a newly frozen selected coin stays frozen when the displayed Freeze action is pressed', async () => {
  const screen = render(<CoinControl />);
  await act(async () => {});
  fireEvent.press(screen.getAllByTestId('SelectCoin')[0]);
  mockMetadata[mockCoins[0].txid] = { frozen: true };
  await act(async () => fireEvent.press(screen.getByText(loc.cc.freezeLabel)));
  expect(mockMetadata[mockCoins[0].txid].frozen).toBe(true);
});
