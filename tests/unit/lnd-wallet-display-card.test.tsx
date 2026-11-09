import React from 'react';
import { render } from '@testing-library/react-native';
import { LndWallet } from '../../class/wallets/lnd-wallet';
import { createNeoxexXbtPriceQuote } from '../../blue_modules/xbt-price';

jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
jest.mock('../../blue_modules/sizeClass', () => ({
  SizeClass: { Small: 'small', Large: 'large' },
  useSizeClass: () => ({ sizeClass: 'small' }),
}));
const mockSettings = { xbtPriceQuote: createNeoxexXbtPriceQuote('300', Date.now()) };
jest.mock('../../hooks/context/useSettings', () => ({ useSettings: () => mockSettings }));
const { WalletCarouselItem } = require('../../components/WalletsCarousel');
const WalletListItem = require('../../components/WalletListItem').default;

test('memoized LND card updates on unit changes even though the wallet object is unchanged', () => {
  const wallet = new LndWallet();
  jest.spyOn(wallet, 'getBalance').mockReturnValue(45998593);
  const onPress = jest.fn();
  const card = () => (
    <WalletCarouselItem
      item={wallet}
      lndDisplayUnit={wallet.getDisplayUnit()}
      hideBalance={wallet.hideBalance}
      onPress={onPress}
      animationsEnabled={false}
    />
  );
  const screen = render(card());
  expect(screen.getByText('0.45998593 XBT')).toBeTruthy();
  wallet.setDisplayUnit('sats');
  screen.rerender(card());
  expect(screen.getByText('45,998,593 sats')).toBeTruthy();
  wallet.setDisplayUnit('quote');
  screen.rerender(card());
  expect(screen.getByText('≈ 138.00 USDC')).toBeTruthy();
  wallet.hideBalance = true;
  screen.rerender(card());
  expect(screen.queryByText('≈ 138.00 USDC')).toBeNull();
  expect(screen.queryByTestId('XbtPriceEstimate')).toBeNull();
  screen.unmount();
});

test('wallet search displays the same remembered LND unit and respects hidden balances', () => {
  const wallet = new LndWallet();
  wallet.setDisplayUnit('quote');
  jest.spyOn(wallet, 'getBalance').mockReturnValue(45998593);
  const props = {
    wallet,
    iconImage: 1,
    onPress: jest.fn(),
    searchQuery: '',
    borderBottomColor: '#000',
    backgroundColor: '#000',
    titleColor: '#fff',
  };
  const screen = render(<WalletListItem {...props} />);
  expect(screen.getByText('≈ 138.00 USDC')).toBeTruthy();
  wallet.hideBalance = true;
  screen.rerender(<WalletListItem {...props} />);
  expect(screen.queryByText('≈ 138.00 USDC')).toBeNull();
  screen.unmount();
});
