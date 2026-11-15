import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SendDetails from '../../screen/send/SendDetails';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import NetworkTransactionFees, { NetworkTransactionFeeType } from '../../models/networkTransactionFees';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
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
test('changing the selected coins before MAX review never sends stale or unselected inputs', async () => {
  const view = await screen();
  const replacement = { txid: '44'.repeat(32), vout: 2, value: 50000, address: ADDRESS };
  // user re-opens coin control and picks a different, smaller set before pressing MAX
  mockRoute.params = { ...mockRoute.params, utxos: [replacement] };
  view.rerender(<SendDetails />);
  await act(async () => {});
  await chooseMax(view);
  const estimate = wallet.coinselect([replacement], [{ address: ADDRESS }], 1);
  expect(mockAmountProps.maxSendableAmount).toBe(50000 - estimate.fee);
  fireEvent.press(view.getByTestId('CreateTransactionButton'));
  await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('Confirm', expect.any(Object)));
  const builderInputs = wallet.createTransaction.mock.calls[0][0];
  expect(builderInputs).toEqual([replacement]);
  for (const stale of [...selected, unselected]) expect(builderInputs).not.toContainEqual(stale);
  const review = mockNavigation.navigate.mock.calls.find(([name]) => name === 'Confirm')[1];
  expect(review.recipients[0].value).toBe(50000 - estimate.fee);
});
test('changing the selected coins after MAX is armed recomputes the amount from the new set only', async () => {
  const view = await screen();
  await chooseMax(view);
  const narrowed = [selected[0]];
  mockRoute.params = { ...mockRoute.params, utxos: narrowed };
  view.rerender(<SendDetails />);
  await act(async () => {});
  const estimate = wallet.coinselect(narrowed, [{ address: ADDRESS }], 1);
  await waitFor(() => expect(mockAmountProps.maxSendableAmount).toBe(100000 - estimate.fee));
  fireEvent.press(view.getByTestId('CreateTransactionButton'));
  await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('Confirm', expect.any(Object)));
  const builderInputs = wallet.createTransaction.mock.calls[0][0];
  expect(builderInputs).toEqual(narrowed);
  expect(builderInputs).not.toContainEqual(selected[1]);
  expect(builderInputs).not.toContainEqual(unselected);
});
test('a changed fee rate before review makes MAX subtract the actual current fee', async () => {
  const view = await screen();
  await chooseMax(view);
  const lowFee = wallet.coinselect(selected, [{ address: ADDRESS }], 1).fee;
  expect(mockAmountProps.maxSendableAmount).toBe(300000 - lowFee);
  // the fee screen returns a custom rate through route params
  mockRoute.params = { ...mockRoute.params, selectedFeeRate: '25', selectedFeeType: NetworkTransactionFeeType.CUSTOM };
  view.rerender(<SendDetails />);
  await act(async () => {});
  const highFee = wallet.coinselect(selected, [{ address: ADDRESS }], 25).fee;
  expect(highFee).toBeGreaterThan(lowFee);
  await waitFor(() => expect(mockAmountProps.maxSendableAmount).toBe(300000 - highFee));
  fireEvent.press(view.getByTestId('CreateTransactionButton'));
  await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('Confirm', expect.any(Object)));
  expect(wallet.createTransaction).toHaveBeenCalledWith(selected, [{ address: ADDRESS }], 25, CHANGE, expect.any(Number), false, 0);
  const review = mockNavigation.navigate.mock.calls.find(([name]) => name === 'Confirm')[1];
  expect(review.satoshiPerByte).toBe(25);
  expect(review.recipients[0].value).toBe(300000 - highFee);
});
test('watch-only MAX prepares an unsigned review for the selected coins only', async () => {
  // Public account key only (no seed, no signing key); the builder is stubbed at the unsigned review boundary.
  const watch = new WatchOnlyWallet();
  watch.setSecret('zpub6r7jhKKm7BAVx3b3nSnuadY1WnshZYkhK8gKFoRLwK9rF3Mzv28BrGcCGA3ugGtawi1WLb2vyjQAX9ZTDGU5gNk2bLdTc3iEXr6tzR1ipNP');
  watch.init();
  watch.getID = () => 'public-max-watch-only';
  const address = watch._getExternalAddressByIndex(0);
  const changeAddress = watch._getInternalAddressByIndex(0);
  const coins = [
    { txid: '55'.repeat(32), vout: 0, value: 120000, address },
    { txid: '66'.repeat(32), vout: 1, value: 80000, address },
  ];
  const other = { txid: '77'.repeat(32), vout: 0, value: 5000000, address };
  watch.getBalance = () => 5200000;
  watch.getUtxo = () => [...coins, other];
  watch.fetchUtxo = jest.fn().mockResolvedValue(undefined);
  watch.getChangeAddressAsync = jest.fn().mockResolvedValue(changeAddress);
  const unsignedReview = { toBase64: () => 'public-unsigned-review-only' };
  watch.createTransaction = jest.fn((inputs, targets, rate) => {
    const { outputs, fee } = watch.coinselect(inputs, targets, rate);
    return { outputs, fee, psbt: unsignedReview, tx: { getId: () => 'public-test-id', toHex: () => 'unsigned' } };
  });
  mockStorage.wallets = [watch];
  mockRoute.params = { ...mockRoute.params, walletID: watch.getID(), utxos: coins };
  const view = await screen();
  await chooseMax(view);
  const estimate = watch.coinselect(coins, [{ address: ADDRESS }], 1);
  expect(mockAmountProps.maxSendableAmount).toBe(200000 - estimate.fee);
  fireEvent.press(view.getByTestId('CreateTransactionButton'));
  await waitFor(() => expect(mockNavigation.navigate).toHaveBeenCalledWith('PsbtWithHardwareWallet', expect.any(Object)));
  expect(watch.createTransaction.mock.calls[0][0]).toEqual(coins);
  expect(watch.createTransaction.mock.calls[0][0]).not.toContainEqual(other);
  // the review goes to the external signer; nothing is offered for broadcast
  expect(mockNavigation.navigate).not.toHaveBeenCalledWith('Confirm', expect.anything());
  expect(mockNavigation.navigate.mock.calls.find(([name]) => name === 'PsbtWithHardwareWallet')[1].psbt).toBe(unsignedReview);
});
