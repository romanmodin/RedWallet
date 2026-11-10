import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, AppState, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import DefaultPreference from 'react-native-default-preference';
import Clipboard from '@react-native-clipboard/clipboard';
import { SettingsProvider } from '../../components/Context/SettingsProvider';
import * as StorageHook from '../../hooks/context/useStorage';
import * as Currency from '../../blue_modules/currency';
import * as XbtPriceHook from '../../hooks/useXbtDisplayPrice';
import { createNeoxexXbtPriceQuote, XbtPriceQuote } from '../../blue_modules/xbt-price';
import { TOTAL_BALANCE_DISPLAY_MODE_KEY } from '../../blue_modules/total-balance-display';
import { CommonToolTipActions } from '../../typings/CommonToolTipActions';
import { FiatUnit } from '../../models/fiatUnit';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import TotalWalletsBalance, { TotalWalletsBalanceKey, TotalWalletsBalancePreferredUnit } from '../../components/TotalWalletsBalance';

let mockMenu: any;
jest.mock('../../components/TooltipMenu', () => ({
  __esModule: true,
  default: (props: any) => {
    mockMenu = props;
    return <View>{props.children}</View>;
  },
}));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
jest.mock('react-native-default-preference', () => ({
  __esModule: true,
  default: {
    setName: jest.fn(async () => {}),
    get: jest.fn(async () => undefined),
    set: jest.fn(async () => {}),
    clear: jest.fn(async () => {}),
  },
}));
jest.mock('electrum-client', () => jest.fn());

const stored = new Map<string, string>();
const wallets = [
  { type: 'HDsegwitBech32XBT', hideBalance: false, getBalance: () => 100_000_000 },
  { type: 'HDsegwitBech32BTC', hideBalance: false, getBalance: () => 200_000_000 },
  { type: 'HDsegwitBech32XBT', hideBalance: true, getBalance: () => 900_000_000 },
];
let quote: XbtPriceQuote | null;
let write: jest.SpyInstance;
let read: jest.SpyInstance;
beforeEach(() => {
  stored.clear();
  quote = createNeoxexXbtPriceQuote('300', Date.now());
  read = jest.spyOn(AsyncStorage, 'getItem').mockImplementation(async key => stored.get(key) ?? null);
  write = jest.spyOn(AsyncStorage, 'setItem').mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
  jest.spyOn(StorageHook, 'useStorage').mockReturnValue({ wallets, walletsInitialized: false } as any);
  jest.spyOn(Currency, 'initCurrencyDaemon').mockResolvedValue(undefined);
  jest.spyOn(Currency, 'getPreferredCurrency').mockResolvedValue(FiatUnit.USD);
  jest.spyOn(XbtPriceHook, 'useXbtDisplayPrice').mockImplementation(() => ({
    xbtPriceQuote: quote,
    saveManualXbtPriceQuote: jest.fn(),
    clearXbtPriceQuote: jest.fn(),
    refreshNeoxexXbtPriceQuote: jest.fn(),
  }));
  jest.spyOn(Clipboard, 'setString').mockImplementation(() => {});
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(AppState, 'addEventListener').mockReturnValue({ remove: jest.fn() });
  (DefaultPreference.get as jest.Mock).mockImplementation(async () => undefined);
  (DefaultPreference.set as jest.Mock).mockClear();
});
afterEach(() => jest.restoreAllMocks());

const flush = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
const open = () =>
  render(
    <SettingsProvider>
      <TotalWalletsBalance />
    </SettingsProvider>,
  );
const amount = (view: ReturnType<typeof render>) => view.getByTestId('TotalWalletsBalanceAmount').props.children[0];
const tap = async (view: ReturnType<typeof render>) =>
  act(async () => {
    fireEvent.press(view.getByLabelText('Change total balance display'));
    await flush();
  });

test('total taps cycle XBT, sats, the correctly labeled USDC quote, hidden, and back without merging BTC', async () => {
  const view = open();
  await act(flush);
  expect(amount(view)).toBe('1');
  expect(view.getByTestId('TotalBtcBalance')).toBeTruthy();
  await tap(view);
  expect(amount(view)).toBe('100,000,000');
  await tap(view);
  expect(amount(view)).toBe('≈ 300.00 USDC');
  await tap(view);
  expect(amount(view)).toBe('••••');
  expect(view.getByLabelText('Change total balance display').props.accessibilityValue.text).toBe('Amounts hidden');
  expect(view.queryByTestId('TotalBtcBalance')).toBeNull();
  expect(view.queryByTestId('XbtPriceEstimate')).toBeNull();
  expect(stored.get(TOTAL_BALANCE_DISPLAY_MODE_KEY)).toBe('hidden');
  await tap(view);
  expect(amount(view)).toBe('1');
  expect(view.getByTestId('TotalBtcBalance')).toBeTruthy();
  expect(wallets[0].getBalance()).toBe(100_000_000);
  view.unmount();
});

test('Hide keeps the total recoverable and a stale Copy callback cannot disclose it', async () => {
  const view = open();
  await act(flush);
  const staleMenu = mockMenu;
  await act(async () => {
    await mockMenu.onPressMenuItem(CommonToolTipActions.Hide.id);
  });
  expect(amount(view)).toBe('••••');
  expect(DefaultPreference.set).not.toHaveBeenCalledWith(TotalWalletsBalanceKey, 'false');
  expect(mockMenu.actions.some((a: any) => a.id === CommonToolTipActions.CopyAmount.id)).toBe(false);
  await act(async () => {
    await staleMenu.onPressMenuItem(CommonToolTipActions.CopyAmount.id);
  });
  expect(Clipboard.setString).not.toHaveBeenCalled();
  await tap(view);
  expect(amount(view)).toBe('1');
  view.unmount();
});

test('a hidden total stays hidden after remount until the user taps to reveal it', async () => {
  stored.set(TOTAL_BALANCE_DISPLAY_MODE_KEY, 'hidden');
  const first = open();
  expect(amount(first)).toBe('••••');
  await act(flush);
  expect(amount(first)).toBe('••••');
  first.unmount();
  const restored = open();
  await act(flush);
  expect(amount(restored)).toBe('••••');
  await tap(restored);
  expect(amount(restored)).toBe('1');
  expect(stored.get(TOTAL_BALANCE_DISPLAY_MODE_KEY)).toBe('XBT');
  restored.unmount();
});

test('a failed unhide save leaves the total, BTC subtotal and price estimate masked', async () => {
  stored.set(TOTAL_BALANCE_DISPLAY_MODE_KEY, 'hidden');
  const view = open();
  await act(flush);
  write.mockRejectedValueOnce(new Error('Storage unavailable'));
  await tap(view);
  expect(amount(view)).toBe('••••');
  expect(view.queryByTestId('TotalBtcBalance')).toBeNull();
  expect(view.queryByTestId('XbtPriceEstimate')).toBeNull();
  expect(stored.get(TOTAL_BALANCE_DISPLAY_MODE_KEY)).toBe('hidden');
  expect(Alert.alert).toHaveBeenCalledWith('Display not saved', expect.any(String));
  view.unmount();
});

test('Copy is blocked while a hide write is pending and after it completes', async () => {
  const view = open();
  await act(flush);
  const previous = mockMenu;
  let complete!: () => void;
  write.mockImplementationOnce(
    (key: string, value: string) =>
      new Promise<void>(resolve => {
        complete = () => {
          stored.set(key, value);
          resolve();
        };
      }),
  );
  let hiding!: Promise<void>;
  await act(async () => {
    hiding = previous.onPressMenuItem(CommonToolTipActions.Hide.id);
    await flush();
  });
  await act(async () => {
    await previous.onPressMenuItem(CommonToolTipActions.CopyAmount.id);
  });
  expect(Clipboard.setString).not.toHaveBeenCalled();
  await act(async () => {
    complete();
    await hiding;
  });
  expect(amount(view)).toBe('••••');
  await act(async () => {
    await previous.onPressMenuItem(CommonToolTipActions.CopyAmount.id);
  });
  expect(Clipboard.setString).not.toHaveBeenCalled();
  view.unmount();
});

test('a delayed startup read cannot overwrite a newer hidden preference', async () => {
  let finishRead!: (mode: string) => void;
  read.mockImplementation((key: string) =>
    key === TOTAL_BALANCE_DISPLAY_MODE_KEY
      ? new Promise(resolve => {
          finishRead = resolve;
        })
      : Promise.resolve(stored.get(key) ?? null),
  );
  const view = open();
  await act(flush);
  expect(amount(view)).toBe('••••');
  await tap(view);
  expect(amount(view)).toBe('1');
  await tap(view);
  await tap(view);
  await tap(view);
  expect(amount(view)).toBe('••••');
  await act(async () => {
    finishRead('XBT');
    await flush();
  });
  expect(amount(view)).toBe('••••');
  expect(stored.get(TOTAL_BALANCE_DISPLAY_MODE_KEY)).toBe('hidden');
  view.unmount();
});

test('an unavailable preference read defaults to hidden and a missing quote never becomes a zero', async () => {
  quote = null;
  read.mockImplementation(async key => {
    if (key === TOTAL_BALANCE_DISPLAY_MODE_KEY) throw new Error('Read unavailable');
    return stored.get(key) ?? null;
  });
  const view = open();
  await act(flush);
  expect(amount(view)).toBe('••••');
  await tap(view);
  await tap(view);
  await tap(view);
  expect(amount(view)).toBe('Rate unavailable');
  await tap(view);
  expect(amount(view)).toBe('••••');
  view.unmount();
});

test('migrates an existing sats preference without changing the whole-section visibility setting', async () => {
  (DefaultPreference.get as jest.Mock).mockImplementation(async key =>
    key === TotalWalletsBalancePreferredUnit ? BitcoinUnit.SATS : undefined,
  );
  const view = open();
  await act(flush);
  expect(amount(view)).toBe('100,000,000');
  expect(DefaultPreference.set).not.toHaveBeenCalledWith(TotalWalletsBalanceKey, 'false');
  view.unmount();
});
