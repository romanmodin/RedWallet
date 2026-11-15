import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SendDetails from '../../screen/send/SendDetails';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import NetworkTransactionFees from '../../models/networkTransactionFees';
import ActionSheet from '../../screen/ActionSheet';
import { confirmXbtPayment } from '../../class/xbt/payment-warning';

let mockRoute;
let mockStorage;
let mockAmountProps;
const mockNavigation = {
  setParams: jest.fn(),
  setOptions: jest.fn(),
  navigate: jest.fn(),
  goBack: jest.fn(),
};
jest.mock('@react-navigation/native', () => ({
  DefaultTheme: { colors: {} },
  DarkTheme: { colors: {} },
  createNavigationContainerRef: () => ({ isReady: () => false }),
  useRoute: () => mockRoute,
  useLocale: () => ({ direction: 'ltr' }),
  useFocusEffect: jest.fn(),
}));
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => mockStorage,
}));
jest.mock('../../hooks/useKeyboard', () => ({
  useKeyboard: () => ({ isVisible: false }),
}));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('../../blue_modules/wallet-network', () => ({
  ...jest.requireActual('../../blue_modules/wallet-network'),
  selectWalletNetwork: jest.fn(),
}));
jest.mock('../../components/SendAmountInput', () => props => {
  mockAmountProps = props;
  return null;
});
jest.mock('../../components/AddressInput', () => () => null);
jest.mock('../../components/CoinsSelected', () => () => null);
jest.mock('../../components/InputAccessoryAllFunds', () => () => null);
jest.mock('../../components/DismissKeyboardInputAccessory', () => ({
  DismissKeyboardInputAccessory: () => null,
}));
jest.mock('../../components/SafeArea', () => 'SafeArea');
jest.mock('../../components/Button', () => {
  const { Pressable, Text } = require('react-native');
  // eslint-disable-next-line react/prop-types -- lightweight native button substitute
  return ({ title, ...props }) => (
    <Pressable {...props}>
      <Text>{title}</Text>
    </Pressable>
  );
});
jest.mock('../../components/headerMenuOptions', () => ({
  createEllipsisHeaderMenuOptions: () => ({}),
}));
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: {},
}));
jest.mock('../../screen/ActionSheet', () => ({
  showActionSheetWithOptions: jest.fn(),
}));
jest.mock('../../class/xbt/payment-warning', () => ({
  confirmXbtPayment: jest.fn().mockResolvedValue(true),
}));

const ADDRESS = 'bc1qcr8te4kr609gcawutmrza0j4xv80jy8z306fyu';
const CHANGE = 'bc1q8c6fshw2dlwun7ekn9qwf37cu2rn755upcp6el';
let wallet;
let selected;
let unselected;
beforeEach(() => {
  jest.clearAllMocks();
  confirmXbtPayment.mockResolvedValue(true);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(NetworkTransactionFees, 'recommendedFees').mockResolvedValue({ fastestFee: 1, mediumFee: 1, slowFee: 1 });
  selected = [
    { txid: '11'.repeat(32), vout: 0, value: 100000, address: ADDRESS },
    { txid: '22'.repeat(32), vout: 1, value: 200000, address: ADDRESS },
  ];
  unselected = {
    txid: '33'.repeat(32),
    vout: 0,
    value: 9000000,
    address: ADDRESS,
  };
  wallet = new XbtSegwitBech32Wallet();
  wallet.getID = () => 'public-max-test';
  wallet.getBalance = () => 9300000;
  wallet.getUtxo = () => [...selected, unselected];
  wallet.fetchUtxo = jest.fn().mockResolvedValue(undefined);
  wallet.getChangeAddressAsync = jest.fn().mockResolvedValue(CHANGE);
  wallet.createTransaction = jest.fn((inputs, targets, rate) => {
    // Keep real coin selection/fee math; stop at the unsigned review boundary.
    const { outputs, fee } = wallet.coinselect(inputs, targets, rate);
    return {
      outputs,
      fee,
      psbt: {},
      tx: {
        getId: () => 'public-test-id',
        toHex: () => 'public-test-review-only',
      },
    };
  });
  mockStorage = {
    wallets: [wallet],
    sleep: () => new Promise(() => {}),
    txMetadata: {},
    saveToDisk: jest.fn().mockResolvedValue(undefined),
  };
  mockRoute = {
    params: {
      walletID: wallet.getID(),
      isEditable: true,
      address: ADDRESS,
      utxos: selected,
      amountUnit: BitcoinUnit.BTC,
    },
  };
});
afterEach(() => jest.restoreAllMocks());

async function screen() {
  const view = render(<SendDetails />);
  await waitFor(() => expect(NetworkTransactionFees.recommendedFees).toHaveBeenCalled());
  await act(async () => {});
  return view;
}
async function chooseMax(view, choice = 1) {
  fireEvent.press(view.getByTestId('SendMaxButton'));
  const [options, callback] = ActionSheet.showActionSheetWithOptions.mock.calls.at(-1);
  await act(async () => callback(choice));
  return options;
}
test('visible MAX reviews only selected coins minus the real network fee', async () => {
  const view = await screen();
  const options = await chooseMax(view);
  expect(options.message).toContain('2');
  expect(options.message).toContain('No unselected coins will be added');
  expect(mockAmountProps.amount).toBe(BitcoinUnit.MAX);
  const estimate = wallet.coinselect(selected, [{ address: ADDRESS }], 1);
  expect(mockAmountProps.maxSendableAmount).toBe(300000 - estimate.fee);
  fireEvent.press(view.getByTestId('CreateTransactionButton'));
  await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('Confirm', expect.any(Object)));
  expect(wallet.createTransaction).toHaveBeenCalledWith(selected, [{ address: ADDRESS }], 1, CHANGE, expect.any(Number), false, 0);
  const review = mockNavigation.navigate.mock.calls.find(([name]) => name === 'Confirm')[1];
  expect(review.recipients).toHaveLength(1);
  expect(review.recipients[0].value).toBe(300000 - estimate.fee);
  expect(wallet.createTransaction.mock.calls[0][0]).not.toContainEqual(unselected);
});
test('cancelling MAX preserves the current amount and does not prepare a transaction', async () => {
  const view = await screen();
  const previous = mockAmountProps.amount;
  await chooseMax(view, 0);
  expect(mockAmountProps.amount).toBe(previous);
  expect(wallet.createTransaction).not.toHaveBeenCalled();
  expect(confirmXbtPayment).not.toHaveBeenCalled();
});
test('an explicitly empty coin selection cannot fall back to the wallet balance', async () => {
  mockRoute.params.utxos = [];
  const view = await screen();
  fireEvent.press(view.getByTestId('SendMaxButton'));
  expect(ActionSheet.showActionSheetWithOptions).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('CreateTransactionButton'));
  expect(wallet.createTransaction).not.toHaveBeenCalled();
});
