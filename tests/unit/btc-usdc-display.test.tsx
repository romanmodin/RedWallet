import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { createNeoxexBtcUsdcPriceQuote, BtcUsdcPriceQuote } from '../../blue_modules/btc-usdc-price';
import { createNeoxexXbtPriceQuote } from '../../blue_modules/xbt-price';
import { BtcSegwitBech32Wallet } from '../../class/wallets/btc-segwit-bech32-wallet';
import { BtcWatchOnlyWallet } from '../../class/wallets/btc-watch-only-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import TotalWalletsBalance from '../../components/TotalWalletsBalance';
import BtcUsdcEstimate from '../../components/BtcUsdcEstimate';
import { WalletCarouselItem } from '../../components/WalletsCarousel';

const NOW = Date.parse('2026-11-10T12:45:00Z');
let mockQuote: BtcUsdcPriceQuote | null;
let mockHidden = false;
const mockWallets = [
  { type: 'HDsegwitBech32XBT', hideBalance: false, getBalance: () => 200_000_000 },
  { type: 'watchOnlyBTC', hideBalance: false, getBalance: () => 12_345_678 },
  { type: 'HDsegwitBech32BTC', hideBalance: true, getBalance: () => 900_000_000 },
];
jest.mock('../../hooks/context/useStorage', () => ({ useStorage: () => ({ wallets: mockWallets }) }));
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({
    btcUsdcPriceQuote: mockQuote,
    xbtPriceQuote: createNeoxexXbtPriceQuote('300', Date.now()),
    isTotalBalanceEnabled: true,
    totalBalanceDisplayMode: mockHidden ? 'hidden' : 'XBT',
    getTotalBalanceDisplayMode: () => (mockHidden ? 'hidden' : 'XBT'),
  }),
}));
jest.mock('../../components/TooltipMenu', () => {
  const { View } = require('react-native');
  return ({ children }: any) => <View>{children}</View>;
});
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
jest.mock('../../blue_modules/sizeClass', () => ({
  SizeClass: { Small: 'small', Large: 'large' },
  useSizeClass: () => ({ sizeClass: 'small' }),
}));
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockQuote = createNeoxexBtcUsdcPriceQuote('50000', NOW);
  mockHidden = false;
});
afterEach(() => jest.restoreAllMocks());

test('main total puts the separate SHA-256 USDC value in parentheses and excludes hidden wallets', () => {
  const view = render(<TotalWalletsBalance />);
  expect(view.getByTestId('TotalBtcBalance')).toHaveTextContent('0.12345678 BTC (≈ 6,172.84 USDC)');
  expect(view.getByText('≈ 600.00 USDC')).toBeTruthy();
  view.unmount();
  mockHidden = true;
  const hidden = render(<TotalWalletsBalance />);
  expect(hidden.queryByTestId('TotalBtcUsdcEstimate')).toBeNull();
  expect(hidden.queryByText(/6,172/)).toBeNull();
});
test.each([BtcSegwitBech32Wallet, BtcWatchOnlyWallet])(
  'SHA-256 hot/watch-only cards display the estimate and hide it with the balance',
  Wallet => {
    const wallet = new Wallet();
    jest.spyOn(wallet, 'getBalance').mockReturnValue(12_345_678);
    const onPress = jest.fn();
    const view = render(<WalletCarouselItem item={wallet} hideBalance={false} onPress={onPress} animationsEnabled={false} />);
    expect(view.getByTestId('WalletBtcUsdcEstimate')).toHaveTextContent('≈ 6,172.84 USDC');
    view.rerender(<WalletCarouselItem item={wallet} hideBalance onPress={onPress} animationsEnabled={false} />);
    expect(view.queryByTestId('WalletBtcUsdcEstimate')).toBeNull();
  },
);
test('never adds the SHA-256 quote to an XBT card', () => {
  const wallet = new XbtSegwitBech32Wallet();
  const view = render(<WalletCarouselItem item={wallet} hideBalance={false} onPress={jest.fn()} animationsEnabled={false} />);
  expect(view.queryByTestId('WalletBtcUsdcEstimate')).toBeNull();
});
test.each([
  [XbtSegwitBech32Wallet, 'XBT', 'default', 36, 20],
  [BtcWatchOnlyWallet, 'BTC', 'compact', 28, 16],
] as const)('keeps the full card amount readable through repeated relayouts', (Wallet, unit, sizeVariant, base, floor) => {
  const wallet = new Wallet();
  jest.spyOn(wallet, 'getBalance').mockReturnValue(12_345_678);
  const amount = '0.12345678 ' + unit;
  const card = (selected: boolean) => (
    <WalletCarouselItem item={wallet} hideBalance={false} onPress={jest.fn()} isSelectedWallet={selected} sizeVariant={sizeVariant} />
  );
  const view = render(card(true));
  const layout = (width: number) =>
    fireEvent(view.getByTestId('WalletCardBalanceRow'), 'layout', {
      nativeEvent: { layout: { width } },
    });
  const measure = (...widths: number[]) =>
    fireEvent(view.getByText(amount), 'textLayout', {
      nativeEvent: { lines: widths.map(width => ({ width })) },
    });
  layout(280);
  for (let i = 0; i < 20; i++) {
    view.rerender(card(i % 2 === 0));
    measure(265);
    expect(view.getByText(amount)).toHaveStyle({ fontSize: base });
  }
  expect(view.getByText(amount).props.adjustsFontSizeToFit).toBeFalsy();
  layout(180);
  measure(160, 110);
  expect(view.getByText(amount)).toHaveStyle({
    fontSize: Math.floor((base * 180) / 270),
  });
  layout(78);
  for (let i = 0; i < 5; i++) measure(78, 75, 75);
  expect(view.getByText(amount)).toHaveStyle({ fontSize: floor });
  expect(view.getByText(amount).props.numberOfLines).toBeUndefined();
  layout(320);
  measure(265);
  expect(view.getByText(amount)).toHaveStyle({ fontSize: base });
  view.unmount();
});
test('shows old trades as stale and never substitutes XBT or USD when the SHA-256 quote is unavailable', () => {
  mockQuote = createNeoxexBtcUsdcPriceQuote('50000', NOW - 16 * 60000);
  const view = render(<BtcUsdcEstimate satoshis={12_345_678} inline />);
  expect(view.getByTestId('BtcUsdcEstimate')).toHaveTextContent('(≈ 6,172.84 USDC · stale quote)');
  mockQuote = null;
  view.rerender(<BtcUsdcEstimate satoshis={12_345_678} inline />);
  expect(view.queryByTestId('BtcUsdcEstimate')).toBeNull();
});
