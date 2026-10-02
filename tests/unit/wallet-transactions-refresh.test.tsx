import React from 'react';
import { RefreshControl } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import presentAlert from '../../components/Alert';
import WalletTransactions from '../../screen/wallets/WalletTransactions';
import { Chain, BitcoinUnit } from '../../models/bitcoinUnits';

const mockNavigate = jest.fn();
const mockNavigation = { navigate: mockNavigate, setOptions: jest.fn(), setParams: jest.fn() };
const mockRoute = { name: 'WalletTransactions', key: 'wallet-transactions', params: { walletID: 'xbt-wallet' } };
const mockWallet = {
  type: 'HDsegwitBech32XBT',
  chain: Chain.ONCHAIN,
  preferredBalanceUnit: BitcoinUnit.BTC,
  _lastTxFetch: 0,
  getID: () => 'xbt-wallet',
  getLabel: () => 'XBT test wallet',
  getBalance: () => 0,
  getTransactions: () => [],
  allowReceive: () => true,
  allowSend: () => true,
  allowBIP47: () => false,
  fetchBalance: jest.fn(),
  fetchTransactions: jest.fn(),
};
const mockRegister = jest.fn();
const mockUnregister = jest.fn();
const mockSave = jest.fn();

jest.mock('../../blue_modules/BlueElectrum', () => ({
  ensureConnected: jest.fn(),
  getPreferredServer: jest.fn(),
}));
jest.mock('../../hooks/context/useStorage', () => ({ useStorage: () => ({ wallets: [mockWallet], saveToDisk: mockSave }) }));
jest.mock('../../hooks/context/useSettings', () => ({ useSettings: () => ({ isElectrumDisabled: false }) }));
jest.mock('../../hooks/useWalletSubscribe', () => ({ __esModule: true, default: () => mockWallet }));
jest.mock('../../hooks/useExtendedNavigation', () => ({ useExtendedNavigation: () => mockNavigation }));
jest.mock('../../hooks/useMenuElements', () => ({
  __esModule: true,
  default: () => ({ registerTransactionsHandler: mockRegister, unregisterTransactionsHandler: mockUnregister }),
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => mockRoute,
  useLocale: () => ({ direction: 'ltr' }),
  useFocusEffect: () => {},
}));
jest.mock('../../hooks/useBiometrics', () => ({
  useBiometrics: () => ({ isBiometricUseCapableAndEnabled: jest.fn(async () => false) }),
  unlockWithBiometrics: jest.fn(async () => true),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('../../blue_modules/environment', () => ({ isDesktop: false, isIOS26OrHigher: false }));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('../../components/Alert', () => ({ __esModule: true, default: jest.fn(), AlertType: { Toast: 'toast' } }));
jest.mock('../../components/TransactionsNavigationHeader', () => ({ __esModule: true, default: () => null, actionKeys: {} }));
jest.mock('../../components/TransactionListItem', () => ({ TransactionListItem: () => null }));
jest.mock('../../navigation/helpers/getWalletTransactionsOptions', () => ({
  __esModule: true,
  default: () => ({}),
  createWalletDetailsHeaderRight: () => undefined,
  createWalletDetailsHeaderRightItems: () => [],
}));
jest.mock('../../components/FloatButtons', () => ({
  FButton: 'Button',
  FContainer: 'View',
  FloatButtonsBottomFade: () => null,
  getFloatingButtonReservedHeight: () => 0,
}));

function renderScreen() {
  return render(<WalletTransactions route={mockRoute as any} navigation={mockNavigation as any} />);
}

describe('WalletTransactions first-run refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (BlueElectrum.getPreferredServer as jest.Mock).mockResolvedValue(undefined);
    (BlueElectrum.ensureConnected as jest.Mock).mockResolvedValue(false);
  });

  it.each([undefined, { host: 'xbt.example' }])('keeps Receive usable without a complete configured server: %p', async server => {
    (BlueElectrum.getPreferredServer as jest.Mock).mockResolvedValue(server);
    const view = renderScreen();
    await waitFor(() => expect(BlueElectrum.getPreferredServer).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(BlueElectrum.ensureConnected).not.toHaveBeenCalled();
    expect(presentAlert).not.toHaveBeenCalled();
    expect(mockWallet.fetchTransactions).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('ReceiveButton'));
    expect(mockNavigate).toHaveBeenCalledWith('ReceiveDetails', { walletID: 'xbt-wallet' });
    view.unmount();
  });

  it('still reports a manual refresh failure without a server', async () => {
    const view = renderScreen();
    await waitFor(() => expect(mockRegister).toHaveBeenCalled());
    await act(async () => {
      await view.UNSAFE_getByType(RefreshControl).props.onRefresh();
    });
    expect(BlueElectrum.ensureConnected).toHaveBeenCalledTimes(1);
    expect(presentAlert).toHaveBeenCalledTimes(1);
    view.unmount();
  });

  it('still reports the final automatic failure for a configured server', async () => {
    (BlueElectrum.getPreferredServer as jest.Mock).mockResolvedValue({ host: 'xbt.example', ssl: 50002 });
    const view = renderScreen();
    await waitFor(() => expect(presentAlert).toHaveBeenCalled());
    expect(BlueElectrum.ensureConnected).toHaveBeenCalledTimes(3);
    expect(mockWallet.fetchTransactions).not.toHaveBeenCalled();
    view.unmount();
  });
});
