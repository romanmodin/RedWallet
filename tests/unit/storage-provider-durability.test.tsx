import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { BlueApp } from '../../class/blue-app';
import { LndWallet } from '../../class/wallets/lnd-wallet';
import { StorageProvider } from '../../components/Context/StorageProvider';
import { useStorage } from '../../hooks/context/useStorage';

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
