import React from 'react';
import Clipboard from '@react-native-clipboard/clipboard';
import { BlueApp } from '../../class/blue-app';
import { TransactionListItem } from '../../components/TransactionListItem';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, NativeModules } from 'react-native';
import { LndWallet, LndOverview } from '../../class/wallets/lnd-wallet';
import { XbtPriceQuote } from '../../blue_modules/xbt-price';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useFocusEffect: (callback: () => void) => {
    require('react').useEffect(callback, [callback]);
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
const mockSettings: { xbtPriceQuote: XbtPriceQuote | null } = {
  xbtPriceQuote: null,
};
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => mockSettings,
}));
const mockNavigation = { navigate: jest.fn(), setOptions: jest.fn() };
const mockStorage = {
  saveToDisk: jest.fn(async (_force = false, _throwOnError = false) => {}),
  wallets: [] as LndWallet[],
  txMetadata: {},
  counterpartyMetadata: {},
};
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('../../hooks/context/useStorage', () => ({
  useStorage: () => mockStorage,
}));
const overview: LndOverview = {
  node: '02' + 'a'.repeat(64),
  synced: true,
  peers: '1',
  height: '980556',
  activeChannels: '1',
  fundingTotal: '800000',
  fundingConfirmed: '790000',
  fundingPending: '10000',
  fundingLocked: '1000',
  anchorReserve: '2000',
  lightningLocal: '99056',
  lightningRemote: '0',
  channelPending: '0',
  splicePending: '0',
};
const bridge = {
  run: jest.fn(async () => 'Running'),
  wallet: jest.fn(async (kind: string) =>
    kind === 'overview'
      ? overview
      : {
          rows:
            kind === 'funding'
              ? [
                  {
                    id: 'funding-tx',
                    direction: 'received',
                    sats: '1000000',
                    feeSats: '0',
                    timestamp: 1700000000,
                    state: 'pending',
                    memo: '',
                    confirmations: 0,
                  },
                ]
              : kind === 'invoices'
                ? [
                    {
                      id: 'invoice-hash',
                      direction: 'received',
                      sats: '500',
                      feeSats: '0',
                      timestamp: 1700000100,
                      state: 'settled',
                      memo: 'Test payment',
                    },
                  ]
                : [],
          next: '0',
          more: false,
        },
  ),
  invoice: jest.fn(),
  manage: jest.fn(),
};
const defaultWallet = bridge.wallet.getMockImplementation()!;
NativeModules.XBTLightningBridge = bridge;
const LndWalletHome = require('../../screen/wallets/LndWalletHome').default;

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  mockStorage.saveToDisk.mockReset().mockResolvedValue(undefined);
  bridge.wallet.mockImplementation(defaultWallet);
  mockStorage.wallets = [];
});
function hiddenWallet() {
  const wallet = new LndWallet();
  wallet.hideBalance = true;
  wallet.setDisplayUnit('sats');
  return wallet;
}
test.each(['amount', 'fee', 'clipboard'])('hidden history details must redact %s', async field => {
  bridge.wallet.mockImplementation(async kind =>
    kind === 'invoices'
      ? ({
          rows: [
            {
              id: 'privacy-hash',
              direction: 'received',
              sats: '123457',
              feeSats: '239',
              timestamp: 1700000100,
              state: 'settled',
              memo: '',
            },
          ],
          next: '0',
          more: false,
        } as never)
      : defaultWallet(kind),
  );
  const s = render(<LndWalletHome wallet={hiddenWallet()} />);
  try {
    await act(async () => {});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(s.getByLabelText('Received · settled'));
    const text = alert.mock.calls.at(-1)![1]!;
    if (field === 'clipboard') {
      const copy = alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Copy details')!;
      copy.onPress!();
      expect(jest.mocked(Clipboard.setString).mock.calls.at(-1)![0]).not.toMatch(/123,457|239 sats/);
    } else expect(text).not.toContain(field === 'amount' ? '123,457 sats' : '239 sats');
  } finally {
    s.unmount();
  }
});
test('hidden cancellation confirmation must redact the invoice amount', async () => {
  bridge.wallet.mockImplementation(async kind =>
    kind === 'invoices'
      ? ({
          rows: [
            {
              id: 'privacy-unpaid',
              direction: 'received',
              sats: '123457',
              feeSats: '0',
              timestamp: 1700000100,
              state: 'unpaid',
              memo: '',
            },
          ],
          next: '0',
          more: false,
        } as never)
      : defaultWallet(kind),
  );
  const s = render(<LndWalletHome wallet={hiddenWallet()} />);
  try {
    await act(async () => {});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    fireEvent.press(s.getByLabelText('Received · unpaid'));
    alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Cancel invoice')!.onPress!();
    expect(alert.mock.calls.at(-1)![1]).not.toContain('123,457 sats');
  } finally {
    s.unmount();
  }
});
test.each(['visible', 'accessibility'])('hidden wallet must redact %s amounts in the actual global-feed row', async surface => {
  const wallet = hiddenWallet();
  wallet.activity = [
    {
      id: 'global-private',
      direction: 'received',
      sats: '123457',
      feeSats: '239',
      timestamp: 1700000100,
      state: 'settled',
      memo: '',
    },
  ];
  const storage = new BlueApp();
  storage.wallets = [wallet];
  mockStorage.wallets = [wallet];
  const item = storage.getTransactions(undefined, 10)[0];
  expect(item.value).toBe(123457); // Data remains exact; the presentation must redact.
  const s = render(<TransactionListItem item={item} itemPriceUnit={BitcoinUnit.SATS} walletID={wallet.getID()} />);
  try {
    if (surface === 'visible') expect(s.queryAllByText('123,457')).toHaveLength(0);
    else expect(s.queryAllByLabelText(/123,457/)).toHaveLength(0);
  } finally {
    s.unmount();
  }
});
test.each([false, true])('real storage write failure must restore previously hidden=%s', async initiallyHidden => {
  const wallet = hiddenWallet();
  wallet.hideBalance = initiallyHidden;
  wallet.setDisplayUnit('quote');
  const storage = new BlueApp();
  storage.wallets = [wallet];
  jest.spyOn(storage, 'getRealmForTransactions').mockRejectedValue(new Error('Disposable failing cache'));
  jest.spyOn(storage, 'setItem').mockRejectedValue(new Error('Disposable failing secure storage'));
  mockStorage.saveToDisk.mockImplementation((_force, throwOnError) => storage.saveToDisk(throwOnError));
  const s = render(<LndWalletHome wallet={wallet} />);
  try {
    await act(async () => {});
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => fireEvent.press(s.getByLabelText('Change wallet display unit')));
    expect(wallet.hideBalance).toBe(initiallyHidden);
    expect(wallet.getDisplayUnit()).toBe('quote');
    expect(alert).toHaveBeenCalledWith('Unit not saved', expect.any(String));
  } finally {
    s.unmount();
  }
});
