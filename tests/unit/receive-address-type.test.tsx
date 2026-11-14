import React from 'react';
import { Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import ReceiveDetails from '../../screen/receive/ReceiveDetails';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { createHotXbtSibling, getXbtReceiveAccount, linkXbtAccounts, setXbtReceiveAccount } from '../../blue_modules/xbt-account-groups';
import { ReceiveDetailsStackParamList } from '../../navigation/ReceiveDetailsStackParamList';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import presentAlert from '../../components/Alert';
import { useBiometrics, unlockWithBiometrics } from '../../hooks/useBiometrics';
import DeeplinkSchemaMatch from '../../class/deeplink-schema-match';

let mockParams: ReceiveDetailsStackParamList['ReceiveDetails'];
let mockUpdate: (() => void) | undefined;
let mockStorage: any;
const mockNavigation = {
  goBack: jest.fn(),
  navigate: jest.fn(),
  setParams: jest.fn(),
};
jest.mock('../../hooks/useBiometrics', () => ({ useBiometrics: jest.fn(), unlockWithBiometrics: jest.fn() }));
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => mockStorage,
}));
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({ isElectrumDisabled: false }),
}));
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('@react-navigation/native', () => ({
  useRoute: () => ({ params: mockParams }),
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));
jest.mock('../../components/themes', () => ({
  useTheme: () => ({
    colors: {
      primary: 'red',
      foregroundColor: 'white',
      alternativeTextColor: 'gray',
      elevated: 'black',
      inputBackgroundColor: 'black',
    },
  }),
}));
jest.mock('../../blue_modules/notifications', () => ({
  tryToObtainPermissions: jest.fn(),
  majorTomToGroundControl: jest.fn(),
}));
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: {},
}));
jest.mock('../../blue_modules/wallet-network', () => ({
  walletElectrum: () => ({
    getBalanceByAddress: jest.fn(async () => ({
      confirmed: 0,
      unconfirmed: 0,
    })),
  }),
  isBtcWallet: () => false,
  walletTicker: () => 'XBT',
  formatWalletBalance: () => '0',
}));
jest.mock('../../components/QRCode', () => ({
  __esModule: true,
  default: ({ value }: any) => <Text testID="ReceiveQrPayload">{value}</Text>,
}));
jest.mock('../../components/CopyTextToClipboard', () => {
  const ReactMock = require('react');
  return {
    __esModule: true,
    default: ReactMock.forwardRef(({ text }: any, _ref: any) => <Text testID="ReceiveCopyPayload">{text}</Text>),
  };
});
jest.mock('../../components/SafeAreaScrollView', () => ({
  __esModule: true,
  default: ({ children }: any) => <View>{children}</View>,
}));
jest.mock('../../components/BlueText', () => ({
  __esModule: true,
  default: Text,
}));
jest.mock('../../components/BlueCard', () => ({
  __esModule: true,
  default: View,
}));
jest.mock('../../components/BlueButtonLink', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../components/Button', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../components/HandOffComponent', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../components/TransactionPendingIconBig', () => ({
  TransactionPendingIconBig: () => null,
}));
jest.mock('../../components/SegmentedControl', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('../../screen/send/success', () => ({ SuccessView: () => null }));
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));

const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function setup(watchOnly = false, grouped = true) {
  jest.spyOn(XbtTaprootWallet.prototype, 'getAddressAsync').mockImplementation(async function (this: XbtTaprootWallet) {
    return this._getExternalAddressByIndex(0);
  });
  const hot = new XbtSegwitBech32Wallet();
  hot.setSecret(seed);
  const tap = createHotXbtSibling(hot);
  const accounts = [hot, tap].map(account => {
    if (!watchOnly) return account;
    const w = new WatchOnlyWallet();
    w.xbt_network = true;
    w.setSecret(
      JSON.stringify({ ExtPubKey: account.getXpub(), MasterFingerprint: '445a39f0', AccountKeyPath: account.getDerivationPath() }),
    );
    w.init();
    return w;
  });
  const [segwit, taproot] = accounts;
  if (grouped) {
    linkXbtAccounts(segwit, taproot);
    setXbtReceiveAccount([segwit, taproot], taproot.getID()); // Exercise an explicitly saved Taproot choice.
  }
  for (const account of accounts) {
    jest.spyOn(account, 'getAddressAsync').mockImplementation(async () => account._getExternalAddressByIndex(0));
  }
  mockStorage = {
    wallets: grouped ? accounts : [segwit],
    addWallet: jest.fn(account => {
      mockStorage.wallets.push(account);
    }),
    deleteWallet: jest.fn(account => {
      mockStorage.wallets = mockStorage.wallets.filter((member: any) => member !== account);
    }),
    saveToDisk: jest.fn(async () => {}),
    sleep: () => new Promise(() => {}),
    fetchAndSaveWalletTransactions: jest.fn(),
  };
  mockParams = { walletID: grouped ? taproot.getID() : segwit.getID() };
  return { segwit, taproot, storage: mockStorage };
}
function Harness() {
  const [, update] = React.useState(0);
  React.useLayoutEffect(() => {
    mockUpdate = () => update(value => value + 1);
    return () => {
      mockUpdate = undefined;
    };
  }, []);
  return <ReceiveDetails />;
}
beforeEach(() => {
  jest.clearAllMocks();
  (useBiometrics as jest.Mock).mockReturnValue({ isBiometricUseCapableAndEnabled: async () => false });
  mockNavigation.setParams.mockImplementation((params: object) => {
    if (Object.entries(params).some(([key, value]) => (mockParams as any)[key] !== value)) {
      mockParams = { ...mockParams, ...params };
      mockUpdate?.();
    }
  });
});
afterEach(() => {
  mockUpdate = undefined;
  jest.restoreAllMocks();
});

test.each([false, true])(
  'Receive immediately shows selected Taproot QR and switches to the actual SegWit account (watch-only %p)',
  async watchOnly => {
    const { segwit, taproot, storage } = setup(watchOnly);
    const view = render(<Harness />);
    const tapAddress = taproot._getExternalAddressByIndex(0);
    const segAddress = segwit._getExternalAddressByIndex(0);
    await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(tapAddress));
    expect(view.getByTestId('ReceiveAddressType-taproot').props.accessibilityState.checked).toBe(true);
    fireEvent.press(view.getByTestId('ReceiveAddressType-taproot'));
    expect(mockParams.walletID).toBe(taproot.getID());
    fireEvent.press(view.getByTestId('ReceiveAddressType-segwit'));
    await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(segAddress));
    expect(view.getByTestId('ReceiveQrPayload').props.children).toBe(DeeplinkSchemaMatch.bip21encode(segAddress));
    expect(view.getByTestId('ReceiveAddressType-segwit').props.accessibilityState.checked).toBe(true);
    expect(view.getByTestId('ReceiveAddressType-taproot').props.accessibilityState.checked).toBe(false);
    expect(storage.saveToDisk).toHaveBeenCalledWith(false, true);
    expect(getXbtReceiveAccount(taproot, storage.wallets)).toBe(segwit);
    view.unmount();
    mockParams = {
      walletID: getXbtReceiveAccount(taproot, storage.wallets).getID(),
    };
    const reopened = render(<Harness />);
    await waitFor(() => expect(reopened.getByTestId('ReceiveCopyPayload').props.children).toBe(segAddress));
    expect(reopened.getByTestId('ReceiveAddressType-segwit').props.accessibilityState.checked).toBe(true);
  },
);

test('unavailable watch-only account cannot be selected or synthesized', async () => {
  const { segwit, storage } = setup(true, false);
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  expect(view.getByTestId('ReceiveAddressType-taproot').props.accessibilityState.disabled).toBe(true);
  fireEvent.press(view.getByTestId('ReceiveAddressType-taproot'));
  expect(storage.wallets).toEqual([segwit]);
  expect(mockParams.walletID).toBe(segwit.getID());
  expect(view.getByText(/Watch-only wallets need/)).toBeTruthy();
});

test('failed save leaves the old address, selection and both saved defaults intact', async () => {
  const { segwit, taproot, storage } = setup();
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  storage.saveToDisk.mockRejectedValueOnce(new Error('Disk unavailable'));
  fireEvent.press(view.getByTestId('ReceiveAddressType-segwit'));
  await waitFor(() => expect(presentAlert).toHaveBeenCalled());
  expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(taproot._getExternalAddressByIndex(0));
  expect(mockParams.walletID).toBe(taproot.getID());
  expect(segwit.xbtAccountGroup?.receiveWalletID).toBe(taproot.getID());
  expect(taproot.xbtAccountGroup?.receiveWalletID).toBe(taproot.getID());
});

test('switching preserves custom payment amount and label on the new address', async () => {
  const { segwit, taproot } = setup();
  const tapAddress = taproot._getExternalAddressByIndex(0);
  mockParams = {
    ...mockParams,
    address: tapAddress,
    allowAddressTypeSwitch: true,
    isCustom: true,
    customAmount: '0.01',
    customUnit: BitcoinUnit.BTC,
    customLabel: 'Test payment',
    bip21encoded: DeeplinkSchemaMatch.bip21encode(tapAddress, {
      amount: '0.01',
      label: 'Test payment',
    }),
  };
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('BitcoinAmountText')).toBeTruthy());
  fireEvent.press(view.getByTestId('ReceiveAddressType-segwit'));
  const expected = DeeplinkSchemaMatch.bip21encode(segwit._getExternalAddressByIndex(0), { amount: '0.01', label: 'Test payment' });
  await waitFor(() => expect(view.getByTestId('ReceiveQrPayload').props.children).toBe(expected));
  expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(expected);
  expect(view.getByTestId('BitcoinAmountText').props.children).toBe('0.01 XBT');
});

test('explicit historical address does not offer account switching', async () => {
  const { segwit } = setup();
  mockParams.address = segwit._getExternalAddressByIndex(3);
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  expect(view.queryByTestId('ReceiveAddressType-taproot')).toBeNull();
  expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(mockParams.address);
});

test('serialized selection keeps current QR while saving and ignores repeated taps', async () => {
  const { taproot, storage } = setup();
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  let finish!: () => void;
  storage.saveToDisk.mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  fireEvent.press(view.getByTestId('ReceiveAddressType-segwit'));
  await waitFor(() => expect(storage.saveToDisk).toHaveBeenCalledWith(false, true));
  expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(taproot._getExternalAddressByIndex(0));
  fireEvent.press(view.getByTestId('ReceiveAddressType-segwit'));
  expect(storage.saveToDisk.mock.calls.filter((args: unknown[]) => args[1] === true)).toHaveLength(1);
  await act(async () => finish());
  expect(view.getByTestId('ReceiveAddressType-segwit').props.accessibilityState.checked).toBe(true);
});

test('leaving during address lookup cannot change the default or navigate later', async () => {
  const { segwit, taproot, storage } = setup();
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  let finish!: (address: string) => void;
  (segwit.getAddressAsync as jest.Mock).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  fireEvent.press(view.getByTestId('ReceiveAddressType-segwit'));
  view.unmount();
  mockNavigation.setParams.mockClear();
  await act(async () => finish(segwit._getExternalAddressByIndex(0)));
  expect(mockNavigation.setParams).not.toHaveBeenCalled();
  expect(storage.saveToDisk).not.toHaveBeenCalledWith(false, true);
  expect(segwit.xbtAccountGroup?.receiveWalletID).toBe(taproot.getID());
});

test.each([false, true])('Native SegWit is preselected for a new group (watch-only %p)', async watchOnly => {
  const { segwit, taproot, storage } = setup(watchOnly);
  linkXbtAccounts(taproot, segwit);
  mockParams = { walletID: getXbtReceiveAccount(taproot, storage.wallets).getID() };
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(segwit._getExternalAddressByIndex(0)));
  expect(view.getByTestId('ReceiveAddressType-segwit').props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByTestId('ReceiveAddressType-taproot'));
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(taproot._getExternalAddressByIndex(0)));
});

test('a hot wallet can add Taproot directly from Receive without changing its SegWit account', async () => {
  const { segwit, taproot, storage } = setup(false, false);
  const sourceID = segwit.getID();
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  fireEvent.press(view.getByTestId('ReceiveAddressType-taproot'));
  await waitFor(() => expect(storage.addWallet).toHaveBeenCalledTimes(1), { timeout: 3000 });
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(taproot._getExternalAddressByIndex(0)), {
    timeout: 3000,
  });
  expect(segwit.getID()).toBe(sourceID);
  expect(segwit.getDerivationPath()).toBe("m/84'/0'/0'");
  expect(storage.wallets).toHaveLength(2);
  expect(getXbtReceiveAccount(segwit, storage.wallets).getID()).toBe(taproot.getID());
});

test('failed hot account save removes only the new sibling and restores the original group', async () => {
  const { segwit, storage } = setup(false, false);
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  storage.saveToDisk.mockRejectedValueOnce(new Error('Disk unavailable'));
  fireEvent.press(view.getByTestId('ReceiveAddressType-taproot'));
  await waitFor(() => expect(storage.deleteWallet).toHaveBeenCalledTimes(1), { timeout: 3000 });
  expect(storage.wallets).toEqual([segwit]);
  expect(segwit.xbtAccountGroup).toBeUndefined();
  expect(mockParams.walletID).toBe(segwit.getID());
});

test('cancelled biometric approval cannot create or switch a hot account', async () => {
  const { segwit, storage } = setup(false, false);
  (useBiometrics as jest.Mock).mockReturnValue({ isBiometricUseCapableAndEnabled: async () => true });
  (unlockWithBiometrics as jest.Mock).mockResolvedValue(false);
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  fireEvent.press(view.getByTestId('ReceiveAddressType-taproot'));
  await waitFor(() => expect(unlockWithBiometrics).toHaveBeenCalledTimes(1));
  expect(storage.addWallet).not.toHaveBeenCalled();
  expect(mockParams.walletID).toBe(segwit.getID());
});

test('a late result from the old account cannot overwrite the newly selected QR', async () => {
  const { segwit, taproot } = setup();
  let finish!: (address: string) => void;
  (taproot.getAddressAsync as jest.Mock).mockReturnValueOnce(
    new Promise(resolve => {
      finish = resolve;
    }),
  );
  const view = render(<Harness />);
  fireEvent.press(view.getByTestId('ReceiveAddressType-segwit'));
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload').props.children).toBe(segwit._getExternalAddressByIndex(0)));
  await act(async () => finish(taproot._getExternalAddressByIndex(0)));
  expect(mockParams.walletID).toBe(segwit.getID());
  expect(view.getByTestId('ReceiveQrPayload').props.children).toBe(DeeplinkSchemaMatch.bip21encode(segwit._getExternalAddressByIndex(0)));
});

test('a hot wallet reuses an existing matching account without duplicating it', async () => {
  const { segwit, taproot, storage } = setup(false, false);
  storage.wallets.push(taproot);
  const view = render(<Harness />);
  await waitFor(() => expect(view.getByTestId('ReceiveCopyPayload')).toBeTruthy());
  fireEvent.press(view.getByTestId('ReceiveAddressType-taproot'));
  await waitFor(() => expect(mockParams.walletID).toBe(taproot.getID()));
  expect(storage.addWallet).not.toHaveBeenCalled();
  expect(storage.wallets).toHaveLength(2);
  expect(getXbtReceiveAccount(segwit, storage.wallets)).toBe(taproot);
});
