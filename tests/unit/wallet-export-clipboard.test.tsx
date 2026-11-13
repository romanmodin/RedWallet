import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { AppState, TurboModuleRegistry } from 'react-native';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { BtcWatchOnlyWallet } from '../../class/wallets/btc-watch-only-wallet';
import { clearSensitiveClipboard, SECRET_CLIPBOARD_TTL_MS } from '../../blue_modules/sensitive-clipboard';
import loc from '../../loc';
import fixture from '../fixtures/keystone3-btc-crypto-account.json';

const mockStorage = { wallets: [] as any[] };
const mockNavigation = { goBack: jest.fn() };
const mockAuthorize = jest.fn();
const mockScreenProtect = {
  enableScreenProtect: jest.fn(),
  disableScreenProtect: jest.fn(),
};
let mockState = { currentAppState: 'active', previousAppState: 'active' };
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => mockStorage,
}));
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({ isPrivacyBlurEnabled: false }),
}));
jest.mock('../../hooks/useSecretExport', () => ({
  useSecretExport: () => mockAuthorize,
}));
jest.mock('../../hooks/useScreenProtect', () => ({
  useScreenProtect: () => mockScreenProtect,
}));
jest.mock('../../hooks/useAppState', () => ({
  __esModule: true,
  default: () => mockState,
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useLocale: () => ({ direction: 'ltr' }),
  useRoute: () => ({ params: { walletID: 'export-test' } }),
}));
jest.mock('../../components/themes', () => ({
  useTheme: () => ({ colors: {} }),
}));
jest.mock('../../components/QRCode', () => () => null);
jest.mock('../../components/HandOffComponent', () => () => null);
jest.mock('../../components/SeedWords', () => () => null);
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: { Selection: 'selection' },
}));

const WalletExport = require('../../screen/wallets/WalletExport').default;
let clipboard = '';
let sensitiveCopy: jest.Mock;
let stateListeners: Set<(state: any) => void>;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  clipboard = '';
  stateListeners = new Set();
  AppState.currentState = 'active';
  mockState = { currentAppState: 'active', previousAppState: 'active' };
  mockAuthorize.mockResolvedValue(true);
  sensitiveCopy = jest.fn(value => {
    clipboard = value;
  });
  const getEnforcing = TurboModuleRegistry.getEnforcing;
  jest
    .spyOn(TurboModuleRegistry, 'getEnforcing')
    .mockImplementation(name => (name === 'RNCClipboard' ? ({ setSensitiveString: sensitiveCopy } as any) : getEnforcing(name)));
  jest.spyOn(Clipboard, 'setString').mockImplementation(value => {
    clipboard = value;
  });
  jest.spyOn(Clipboard, 'getString').mockImplementation(async () => clipboard);
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    stateListeners.add(listener);
    return { remove: () => stateListeners.delete(listener) };
  });
});

afterEach(async () => {
  await clearSensitiveClipboard();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each([WatchOnlyWallet, BtcWatchOnlyWallet])(
  '%p export remains pasteable after switching apps and the secret expiry interval',
  async Wallet => {
    const { xpub, path } = fixture.accounts[0];
    const fingerprint = fixture.masterFingerprint.toLowerCase();
    const origin = '[' + fingerprint + '/' + path.slice(2) + ']';
    const expectedExport = 'wpkh(' + origin + xpub + '/<0;1>/*)';
    const wallet = new Wallet();
    wallet.setSecret(origin + xpub);
    wallet.init();
    jest.spyOn(wallet, 'getID').mockReturnValue('export-test');
    mockStorage.wallets = [wallet];
    const screen = render(<WalletExport />);
    fireEvent.press(screen.getByTestId('WalletExportCopy'));
    expect(clipboard).toBe(expectedExport);
    expect(sensitiveCopy).not.toHaveBeenCalled();
    expect(screen.getByText(loc._.copied)).toBeTruthy();
    expect(mockAuthorize).not.toHaveBeenCalled();

    await act(async () => {
      AppState.currentState = 'background';
      mockState = { previousAppState: 'active', currentAppState: 'background' };
      for (const listener of stateListeners) listener('background');
      screen.rerender(<WalletExport />);
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(SECRET_CLIPBOARD_TTL_MS);
    });
    expect(clipboard).toBe(expectedExport);
    const restored = new Wallet();
    restored.setSecret(clipboard);
    restored.init();
    expect(restored.getMasterFingerprintHex()).toBe(fingerprint);
    expect(restored.getDerivationPath()).toBe(path);
    expect(restored._getExternalAddressByIndex(7)).toBe(wallet._getExternalAddressByIndex(7));
    expect(restored._getInternalAddressByIndex(7)).toBe(wallet._getInternalAddressByIndex(7));
    expect(mockNavigation.goBack).not.toHaveBeenCalled();
    screen.unmount();
  },
);

test('private export still authenticates and clears the copied value when backgrounded', async () => {
  mockStorage.wallets = [
    {
      getID: () => 'export-test',
      getSecret: () => 'private-export-fixture',
      type: 'legacy',
      typeReadable: 'Legacy',
    },
  ];
  const screen = render(<WalletExport />);
  expect(screen.queryByTestId('WalletExportCopy')).toBeNull();
  await act(async () => {});
  expect(mockAuthorize).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByTestId('WalletExportCopy'));
  expect(sensitiveCopy).toHaveBeenCalledWith('private-export-fixture');
  expect(clipboard).toBe('private-export-fixture');
  await act(async () => {
    AppState.currentState = 'background';
    mockState = { previousAppState: 'active', currentAppState: 'background' };
    for (const listener of stateListeners) listener('background');
    screen.rerender(<WalletExport />);
  });
  expect(clipboard).toBe('');
  expect(screen.queryByTestId('WalletExportCopy')).toBeNull();
  screen.unmount();
});
