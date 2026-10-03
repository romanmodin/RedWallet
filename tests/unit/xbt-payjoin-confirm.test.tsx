import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Confirm from '../../screen/send/Confirm';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { HDSegwitBech32Wallet } from '../../class/wallets/hd-segwit-bech32-wallet';
import loc from '../../loc';
import fixture from '../fixtures/xbt-knots-regtest-acceptance.json';

const mockWallets: (XbtSegwitBech32Wallet | HDSegwitBech32Wallet)[] = [];
const mockRoute = {
  params: {
    recipients: [],
    targets: [],
    walletID: '',
    fee: 0,
    memo: '',
    tx: fixture.signed.goodHex,
    satoshiPerByte: 1,
    payjoinUrl: 'https://payee.example/payjoin',
    psbt: undefined,
  },
};
const mockNavigation = {
  navigate: jest.fn(),
  setOptions: jest.fn(),
  goBack: jest.fn(),
};
const mockConnect = jest.fn();
const mockAlert = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => mockRoute,
}));
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => ({ wallets: mockWallets }),
}));
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({ isElectrumDisabled: false }),
}));
jest.mock('../../hooks/useBiometrics', () => ({
  useBiometrics: () => ({ isBiometricUseCapableAndEnabled: async () => false }),
}));
jest.mock('../../blue_modules/BlueElectrum', () => ({
  ensureConnected: (...args: unknown[]) => mockConnect(...args),
}));
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockAlert(...args),
}));
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: { NotificationError: 'notificationError' },
}));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

describe('send confirmation Payjoin capability', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWallets.length = 0;
  });

  function selectWallet(wallet: XbtSegwitBech32Wallet | HDSegwitBech32Wallet) {
    wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    mockWallets.push(wallet);
    mockRoute.params.walletID = wallet.getID();
  }

  it('hides Payjoin when an XBT payment route supplies an endpoint', () => {
    selectWallet(new XbtSegwitBech32Wallet());
    expect(render(<Confirm />).queryByTestId('PayjoinSwitch')).toBeNull();
  });

  it('fails closed when the selected wallet changes after Payjoin is enabled', async () => {
    selectWallet(new HDSegwitBech32Wallet());
    const view = render(<Confirm />);
    fireEvent(view.getByTestId('PayjoinSwitch'), 'valueChange', true);
    mockWallets.length = 0;
    selectWallet(new XbtSegwitBech32Wallet());
    view.rerender(<Confirm />);
    expect(view.queryByTestId('PayjoinSwitch')).toBeNull();
    fireEvent.press(view.getByText(loc.send.confirm_sendNow));
    await waitFor(() =>
      expect(mockAlert).toHaveBeenCalledWith({
        message: 'Payjoin is not supported by this wallet',
      }),
    );
    expect(mockConnect).not.toHaveBeenCalled();
  });
});

const mockFeeConfirm = jest.fn();
jest.mock('../../helpers/confirm', () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockFeeConfirm(...args),
}));
it('requires high-fee approval before accessing the network', async () => {
  const wallet = new XbtSegwitBech32Wallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  mockWallets.splice(0, mockWallets.length, wallet);
  mockRoute.params.walletID = wallet.getID();
  Object.assign(mockRoute.params, {
    fee: 100_001 / 1e8,
    recipients: [{ value: 1_000_000 }],
    satoshiPerByte: 1000,
  });
  mockFeeConfirm.mockResolvedValue(false);
  mockConnect.mockClear();
  const view = render(<Confirm />);
  fireEvent.press(view.getByText(loc.send.confirm_sendNow));
  await waitFor(() => expect(mockFeeConfirm).toHaveBeenCalledWith('High transaction fee', expect.any(String)));
  expect(mockConnect).not.toHaveBeenCalled();
});
