import React from 'react';
import { renderHook, act } from '@testing-library/react-native';
import { BlueApp } from '../../class/blue-app';
import { LndWallet } from '../../class/wallets/lnd-wallet';
import { StorageProvider } from '../../components/Context/StorageProvider';
import { useStorage } from '../../hooks/context/useStorage';
import { BtcSegwitBech32Wallet } from '../../class/wallets/btc-segwit-bech32-wallet';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { BlueURDecoder } from '../../blue_modules/ur';
import { UR, UREncoder } from '@ngraveio/bc-ur';
import startImport from '../../class/wallet-import';
import fixture from '../fixtures/keystone3-btc-crypto-account.json';

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

test.each(['zpub', 'xpub'])(
  're-importing the Keystone QR restores the fingerprint on an existing %s account and can be retried after a save fails',
  async format => {
    const decoder = new BlueURDecoder();
    const ur = new UR(Buffer.from(fixture.cborHex, 'hex'), fixture.registryType);
    decoder.receivePart(UREncoder.encodeSinglePart(ur));
    const { wallets } = await startImport(
      decoder.toString(),
      false,
      false,
      true,
      () => {},
      () => {},
      async () => '',
      true,
    ).promise;
    const incoming = wallets.find(wallet => wallet instanceof WatchOnlyWallet && wallet.getDerivationPath() === fixture.accounts[0].path);
    if (!(incoming instanceof WatchOnlyWallet)) throw new Error('Missing BIP84 public account from the Keystone fixture');
    expect(incoming.getMasterFingerprintHex()).toBe(fixture.masterFingerprint.toLowerCase());

    const existing = new WatchOnlyWallet();
    const { xpub, path } = fixture.accounts[0];
    existing.setSecret(format === 'zpub' ? incoming.getSecret() : JSON.stringify({ keystore: { xpub, derivation: path } }));
    existing.xbt_network = true;
    existing.init();
    existing.setLabel('Existing account');
    const originalID = existing.getID();
    const originalAddress = existing._getExternalAddressByIndex(0);
    expect(existing.getMasterFingerprintHex()).toBe('00000000');

    const storage = BlueApp.getInstance();
    const previous = storage.wallets;
    storage.wallets = [existing];
    let restored: WatchOnlyWallet | undefined;
    const save = jest
      .spyOn(storage, 'saveToDisk')
      .mockRejectedValueOnce(new Error('Disposable write failure'))
      .mockImplementation(async () => {
        restored = (WatchOnlyWallet.fromJson(JSON.stringify(existing)) as unknown as WatchOnlyWallet).init();
      });
    const { result, unmount } = renderHook(useStorage, {
      wrapper: ({ children }) => <StorageProvider>{children}</StorageProvider>,
    });

    try {
      await act(async () => {
        await result.current.addAndSaveWallet(incoming);
      });
      expect(existing.getMasterFingerprintHex()).toBe('00000000');
      expect(storage.wallets).toEqual([existing]);

      await act(async () => {
        await result.current.addAndSaveWallet(incoming);
      });
      expect(save).toHaveBeenLastCalledWith(true);
      expect(storage.wallets).toEqual([existing]);
      expect(restored?.getID()).toBe(originalID);
      expect(restored?.getLabel()).toBe('Existing account');
      expect(restored?._getExternalAddressByIndex(0)).toBe(originalAddress);
      expect(restored?.getMasterFingerprintHex()).toBe(fixture.masterFingerprint.toLowerCase());

      incoming.setMasterFingerprint(1);
      await act(async () => {
        await result.current.addAndSaveWallet(incoming);
      });
      expect(save).toHaveBeenCalledTimes(2);
      expect(existing.getMasterFingerprintHex()).toBe(fixture.masterFingerprint.toLowerCase());
    } finally {
      unmount();
      save.mockRestore();
      storage.wallets = previous;
    }
  },
);
