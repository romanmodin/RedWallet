import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import Screen from '../../screen/wallets/XbtAccountGroup';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { createHotXbtSibling, linkXbtAccounts } from '../../blue_modules/xbt-account-groups';
import { useStorage } from '../../hooks/context/useStorage';
import { useRoute } from '@react-navigation/native';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import confirm from '../../helpers/confirm';
import { unlockWithBiometrics, useBiometrics } from '../../hooks/useBiometrics';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
jest.mock('electrum-client', () => jest.fn());
jest.mock('../../hooks/context/useStorage', () => ({ useStorage: jest.fn() }));
jest.mock('../../hooks/useExtendedNavigation', () => ({ useExtendedNavigation: jest.fn() }));
jest.mock('@react-navigation/native', () => ({ ...jest.requireActual('@react-navigation/native'), useRoute: jest.fn() }));
jest.mock('../../hooks/useBiometrics', () => ({ useBiometrics: jest.fn(), unlockWithBiometrics: jest.fn() }));
jest.mock('../../helpers/confirm', () => jest.fn());
jest.mock('../../components/XbtFiatEstimate', () => () => null);
jest.mock('../../components/SettingsSection', () => {
  const { Pressable, Text } = require('react-native');
  return {
    SettingsListItem: ({ title, rightTitle, onPress, disabled, testID }: any) => (
      <Pressable disabled={disabled} onPress={onPress} testID={testID}>
        <Text>{title}</Text>
        <Text>{rightTitle}</Text>
      </Pressable>
    ),
  };
});
jest.mock('../../components/themes', () => ({
  useTheme: () => ({ colors: { foregroundColor: 'white', alternativeTextColor: 'gray', background: 'black' } }),
}));

const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
function setup(group = true) {
  const a = new XbtSegwitBech32Wallet();
  a.setSecret(seed);
  a.setLabel('Test wallet');
  const b = createHotXbtSibling(a);
  if (group) linkXbtAccounts(a, b);
  const storage = {
    wallets: group ? [a, b] : [a],
    saveToDisk: jest.fn(async () => {}),
    addWallet: jest.fn((_wallet: any) => {}),
    deleteWallet: jest.fn(),
    fetchAndSaveWalletTransactions: jest.fn(async () => {}),
  };
  const navigate = jest.fn();
  (useStorage as jest.Mock).mockReturnValue(storage);
  (useExtendedNavigation as jest.Mock).mockReturnValue({ navigate });
  (useRoute as jest.Mock).mockReturnValue({ params: { walletID: a.getID(), settings: true } });
  (useBiometrics as jest.Mock).mockReturnValue({ isBiometricUseCapableAndEnabled: async () => false });
  (confirm as jest.Mock).mockResolvedValue(true);
  return { a, b, storage, navigate };
}
beforeEach(() => jest.clearAllMocks());

test('settings selection saves the receive account and Receive routes to that actual wallet', async () => {
  const { a, b, storage, navigate } = setup();
  const view = render(<Screen />);
  fireEvent.press(view.getByTestId('ReceiveType-taproot'));
  await waitFor(() => expect(storage.saveToDisk).toHaveBeenCalledWith(false, true));
  expect(a.xbtAccountGroup?.receiveWalletID).toBe(b.getID());
  view.rerender(<Screen />);
  fireEvent.press(view.getByText('BACK TO WALLET'));
  fireEvent.press(view.getByText('RECEIVE · TAPROOT'));
  expect(navigate).toHaveBeenCalledWith('ReceiveDetails', { walletID: b.getID() });
});

test('failed persistence restores both default-receive settings', async () => {
  const { a, b, storage } = setup();
  storage.saveToDisk.mockRejectedValueOnce(new Error('Disk unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<Screen />);
  fireEvent.press(view.getByTestId('ReceiveType-taproot'));
  await waitFor(() => expect(alert).toHaveBeenCalled());
  expect(a.xbtAccountGroup?.receiveWalletID).toBe(a.getID());
  expect(b.xbtAccountGroup?.receiveWalletID).toBe(a.getID());
  alert.mockRestore();
});

test('canceled pairing and failed enabled biometrics never add or save an account', async () => {
  const { storage } = setup(false);
  (confirm as jest.Mock).mockResolvedValueOnce(false);
  const view = render(<Screen />);
  fireEvent.press(view.getByText('ADD TAPROOT'));
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(storage.addWallet).not.toHaveBeenCalled();
  (useBiometrics as jest.Mock).mockReturnValue({ isBiometricUseCapableAndEnabled: async () => true });
  (unlockWithBiometrics as jest.Mock).mockResolvedValue(false);
  view.rerender(<Screen />);
  fireEvent.press(view.getByText('ADD TAPROOT'));
  await waitFor(() => expect(unlockWithBiometrics).toHaveBeenCalled());
  expect(storage.addWallet).not.toHaveBeenCalled();
  expect(storage.saveToDisk).not.toHaveBeenCalled();
});

test('failed save of a new hot sibling rolls it back without removing the source', async () => {
  const { a, storage } = setup(false);
  storage.saveToDisk.mockRejectedValueOnce(new Error('Disk unavailable'));
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<Screen />);
  fireEvent.press(view.getByText('ADD TAPROOT'));
  await waitFor(() => expect(storage.deleteWallet).toHaveBeenCalledTimes(1));
  const sibling = storage.addWallet.mock.calls[0][0];
  expect(storage.deleteWallet).toHaveBeenCalledWith(sibling);
  expect(sibling).not.toBe(a);
  expect(a.xbtAccountGroup).toBeUndefined();
  expect(storage.fetchAndSaveWalletTransactions).not.toHaveBeenCalled();
  alert.mockRestore();
});

test('watch-only settings offer import guidance rather than deriving private accounts', () => {
  const { storage } = setup(false);
  const w = new WatchOnlyWallet();
  w.xbt_network = true;
  w._hdWalletInstance = new XbtSegwitBech32Wallet();
  storage.wallets = [w as any];
  (useRoute as jest.Mock).mockReturnValue({ params: { walletID: w.getID(), settings: true } });
  const view = render(<Screen />);
  expect(view.queryByText('ADD TAPROOT')).toBeNull();
  expect(view.getByText(/Import the other public account/)).toBeTruthy();
});

test('send selection routes only the chosen real account, never a synthetic group ID', () => {
  const { a, b, navigate } = setup();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<Screen />);
  fireEvent.press(view.getByText('BACK TO WALLET'));
  fireEvent.press(view.getByText('SEND'));
  const buttons = alert.mock.calls[0][2]!;
  buttons[1].onPress!();
  expect(navigate).toHaveBeenCalledWith('SendDetailsRoot', { screen: 'SendDetails', params: { walletID: b.getID() } });
  expect(navigate).not.toHaveBeenCalledWith('SendDetailsRoot', { screen: 'SendDetails', params: { walletID: a.xbtAccountGroup!.id } });
  alert.mockRestore();
});

test('adding the other hot address type saves both accounts without constructing or sending a payment', async () => {
  const { a, storage, navigate } = setup(false);
  const view = render(<Screen />);
  fireEvent.press(view.getByText('ADD TAPROOT'));
  await waitFor(() => expect(storage.fetchAndSaveWalletTransactions).toHaveBeenCalledTimes(1));
  const sibling = storage.addWallet.mock.calls[0][0];
  expect(sibling.getSecret()).toBe(a.getSecret());
  expect(sibling.getDerivationPath()).toBe("m/86'/0'/0'");
  expect(storage.saveToDisk).toHaveBeenCalledWith(false, true);
  expect(a.xbtAccountGroup?.id).toBe(sibling.xbtAccountGroup.id);
  expect(navigate).not.toHaveBeenCalled();
});

test('leaving the screen while confirming cannot create a sibling account', async () => {
  const { storage } = setup(false);
  let answer!: (confirmed: boolean) => void;
  (confirm as jest.Mock).mockReturnValue(
    new Promise(resolve => {
      answer = resolve;
    }),
  );
  const view = render(<Screen />);
  fireEvent.press(view.getByText('ADD TAPROOT'));
  view.unmount();
  answer(true);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(storage.addWallet).not.toHaveBeenCalled();
  expect(storage.saveToDisk).not.toHaveBeenCalled();
});

test('a hidden member masks aggregate balance and all grouped transaction amounts', () => {
  const { a, b } = setup();
  a.hideBalance = true;
  jest.spyOn(a, 'getBalance').mockReturnValue(123456789);
  jest.spyOn(b, 'getBalance').mockReturnValue(100);
  jest
    .spyOn(a, 'getTransactions')
    .mockReturnValue([{ txid: 'public-fixture', hash: 'public-fixture', value: 123456789, timestamp: 1 } as any]);
  const view = render(<Screen />);
  fireEvent.press(view.getByText('BACK TO WALLET'));
  expect(view.getByText('••••••')).toBeTruthy();
  expect(view.queryByText(/1.23456789/)).toBeNull();
  expect(view.queryByText('Received')).toBeNull();
});
