import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { BlueApp } from '../../class/blue-app';
import { LndWallet } from '../../class/wallets/lnd-wallet';
import { StorageProvider } from '../../components/Context/StorageProvider';
import { useStorage } from '../../hooks/context/useStorage';
import { BtcSegwitBech32Wallet } from '../../class/wallets/btc-segwit-bech32-wallet';

jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: { NotificationSuccess: 'NotificationSuccess', NotificationError: 'NotificationError' },
}));

test('the real provider propagates strict persistence errors to privacy callers', async () => {
  const storage = BlueApp.getInstance();
  const previous = storage.wallets;
  storage.wallets = [new LndWallet()];
  const failing = jest.spyOn(storage, 'getRealmForTransactions').mockRejectedValue(new Error('Disposable cache failure'));
  const { result, unmount } = renderHook(useStorage, {
    wrapper: ({ children }) => <StorageProvider>{children}</StorageProvider>,
  });
  try {
    await act(async () => {
      await expect(result.current.saveToDisk(false, true)).rejects.toThrow('Disposable cache failure');
    });
  } finally {
    unmount();
    failing.mockRestore();
    storage.wallets = previous;
  }
});

test('importing a blue BTC wallet saves it without starting a network refresh', async () => {
  const storage = BlueApp.getInstance();
  const previous = storage.wallets;
  storage.wallets = [];
  const saved = jest.spyOn(storage, 'saveToDisk').mockResolvedValue(undefined);
  const wallet = new BtcSegwitBech32Wallet();
  wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
  const refresh = jest.spyOn(wallet, 'fetchBalance').mockRejectedValue(new Error('BTC is not selected'));
  const { result, unmount } = renderHook(useStorage, {
    wrapper: ({ children }) => <StorageProvider>{children}</StorageProvider>,
  });
  try {
    await act(async () => {
      await result.current.addAndSaveWallet(wallet);
    });
    expect(saved).toHaveBeenCalled();
    expect(storage.wallets).toContain(wallet);
    expect(refresh).not.toHaveBeenCalled();
  } finally {
    unmount();
    saved.mockRestore();
    storage.wallets = previous;
  }
});
