import React, { useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import SendAmountInput from '../../components/SendAmountInput';
import { BitcoinUnit } from '../../models/bitcoinUnits';
import { SendAsset, UsdcSendEntry, validateUsdcSendRecipient } from '../../blue_modules/send-usdc';
import { fetchNeoxexBtcPrice, fetchNeoxexPrice } from '../../blue_modules/neoxex-price';

const NOW = 1800000000000;
let mockBtc: any;
let mockXbt: any;
let current: {
  amount: string;
  amountSats: number;
  unit: BitcoinUnit;
  usdcEntry?: UsdcSendEntry;
  usdcRefreshing?: boolean;
};
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({ btcUsdcPriceQuote: mockBtc, xbtPriceQuote: mockXbt }),
}));
jest.mock('../../blue_modules/neoxex-price', () => ({
  fetchNeoxexBtcPrice: jest.fn(),
  fetchNeoxexPrice: jest.fn(),
}));
jest.mock('../../components/themes', () => {
  const actual = jest.requireActual('../../components/themes');
  return { ...actual, useTheme: () => actual.BlueDefaultTheme };
});
jest.mock('../../components/BtcUsdcEstimate', () => 'BtcEstimate');
jest.mock('../../components/XbtFiatEstimate', () => 'XbtEstimate');
function Harness({ asset, amount = '0.1', disabled = false }: { asset: SendAsset; amount?: string; disabled?: boolean }) {
  const [state, setState] = useState<typeof current>({
    amount,
    amountSats: Number(amount) * 100000000,
    unit: BitcoinUnit.BTC,
  });
  useEffect(() => {
    current = state;
  }, [state]);
  return (
    <SendAmountInput
      assetTicker={asset}
      {...state}
      disabled={disabled}
      onChangeText={jest.fn()}
      onAmountUnitChange={jest.fn()}
      onQuoteRefreshChange={refreshing => setState(s => ({ ...s, usdcRefreshing: refreshing }))}
      onSatsChange={(sats, coins, usdcEntry) =>
        setState(s => ({
          ...s,
          amount: coins ?? sats,
          amountSats: Number(sats),
          unit: coins === undefined ? BitcoinUnit.SATS : BitcoinUnit.BTC,
          usdcEntry,
        }))
      }
    />
  );
}
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  mockBtc = {
    source: 'neoxex',
    pair: 'BTC_USDC',
    currency: 'USDC',
    pricePerBtc: '73300',
    updatedAt: NOW,
    fetchedAt: NOW,
  };
  mockXbt = {
    source: 'neoxex',
    currency: 'USDC',
    pricePerXbt: '275',
    updatedAt: NOW,
    fetchedAt: NOW,
  };
  jest.mocked(fetchNeoxexBtcPrice).mockReset();
  jest.mocked(fetchNeoxexPrice).mockReset();
});
afterEach(() => jest.restoreAllMocks());

test.each<SendAsset>(['BTC', 'XBT'])('%s rotates coins → sats → USDC → coins without changing the amount', asset => {
  const view = render(<Harness asset={asset} />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  expect(current.unit).toBe(BitcoinUnit.SATS);
  expect(current.amountSats).toBe(10000000);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  expect(view.getByTestId('SendUsdcInput').props.value).toBe(asset === 'BTC' ? '7330' : '27.5');
  expect(() => validateUsdcSendRecipient(current, asset, NOW)).not.toThrow();
  fireEvent.press(view.getByLabelText(`Change USDC to ${asset}`));
  expect(current.amount).toBe('0.1');
  expect(current.unit).toBe(BitcoinUnit.BTC);
  expect(current.usdcEntry).toBeUndefined();
});
test.each<SendAsset>(['BTC', 'XBT'])('%s USDC typing converts with its own quote and invalid drafts clear the amount', asset => {
  const view = render(<Harness asset={asset} />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.changeText(view.getByTestId('SendUsdcInput'), '1');
  expect(current.amountSats).toBe(asset === 'BTC' ? 1364 : 363636);
  expect(() => validateUsdcSendRecipient(current, asset, NOW)).not.toThrow();
  fireEvent.changeText(view.getByTestId('SendUsdcInput'), 'invalid');
  expect(current.amount).toBe('');
  expect(current.amountSats).toBe(0);
  expect(() => validateUsdcSendRecipient(current, asset, NOW)).toThrow();
});
test('background quote changes do not silently reprice an entered amount', () => {
  const view = render(<Harness asset="BTC" />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.changeText(view.getByTestId('SendUsdcInput'), '1');
  mockBtc = { ...mockBtc, pricePerBtc: '50000' };
  view.rerender(<Harness asset="BTC" />);
  expect(current.amountSats).toBe(1364);
  fireEvent.changeText(view.getByTestId('SendUsdcInput'), '2');
  expect(current.amountSats).toBe(2728);
});
test('explicit refresh uses the current rate and review is blocked until it finishes', async () => {
  let finish: (value: any) => void = () => {};
  jest.mocked(fetchNeoxexBtcPrice).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const view = render(<Harness asset="BTC" />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.changeText(view.getByTestId('SendUsdcInput'), '1');
  fireEvent.press(view.getByTestId('RefreshSendUsdcQuote'));
  expect(() => validateUsdcSendRecipient(current, 'BTC', NOW)).toThrow(/refreshing/);
  await act(async () => finish({ ...mockBtc, pricePerBtc: '50000' }));
  expect(current.amountSats).toBe(2000);
  expect(current.usdcRefreshing).toBe(false);
  expect(() => validateUsdcSendRecipient(current, 'BTC', NOW)).not.toThrow();
  expect(fetchNeoxexPrice).not.toHaveBeenCalled();
});
test('stale quote and manual XBT quote cannot enter USDC without refreshing', () => {
  mockXbt = { ...mockXbt, source: 'manual' };
  const view = render(<Harness asset="XBT" />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  expect(view.queryByTestId('SendUsdcInput')).toBeNull();
  expect(current.amountSats).toBe(10000000);
  expect(Alert.alert).toHaveBeenCalledWith('USDC entry unavailable', expect.any(String), expect.any(Array));
  mockXbt = { ...mockXbt, source: 'neoxex', updatedAt: NOW - 900000 };
  view.rerender(<Harness asset="XBT" />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  expect(view.queryByTestId('SendUsdcInput')).toBeNull();
});
test('failed refresh preserves the reviewed amount and clears the busy state', async () => {
  jest.mocked(fetchNeoxexPrice).mockRejectedValue(new Error('Price unavailable'));
  const view = render(<Harness asset="XBT" />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  await act(async () => fireEvent.press(view.getByTestId('RefreshSendUsdcQuote')));
  expect(current.amountSats).toBe(10000000);
  expect(current.usdcRefreshing).toBe(false);
});
test('read-only amount cannot rotate or change its conversion', () => {
  const view = render(<Harness asset="BTC" disabled />);
  expect(view.queryByTestId('changeAmountUnitButton')).toBeNull();
  expect(current.unit).toBe(BitcoinUnit.BTC);
});

test.each(['disabled', 'unmounted'])('late refresh cannot change an amount after its input is %s', async mode => {
  let finish: (value: any) => void = () => {};
  jest.mocked(fetchNeoxexBtcPrice).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const view = render(<Harness asset="BTC" />);
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.press(view.getByTestId('changeAmountUnitButton'));
  fireEvent.changeText(view.getByTestId('SendUsdcInput'), '1');
  fireEvent.press(view.getByTestId('RefreshSendUsdcQuote'));
  if (mode === 'unmounted') view.unmount();
  else view.rerender(<Harness asset="BTC" disabled />);
  await act(async () => finish({ ...mockBtc, pricePerBtc: '50000' }));
  expect(current.amountSats).toBe(1364);
});
