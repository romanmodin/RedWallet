import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import BtcSendAmountInput from '../../components/BtcSendAmountInput';
import { BitcoinUnit } from '../../models/bitcoinUnits';
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({
    btcUsdcPriceQuote: {
      source: 'neoxex',
      pair: 'BTC_USDC',
      currency: 'USDC',
      pricePerBtc: '73300',
      updatedAt: Date.now(),
      fetchedAt: Date.now(),
    },
  }),
}));
jest.mock('../../components/themes', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('../../components/BtcUsdcEstimate', () => 'Estimate');
jest.mock('../../components/AmountInput', () => ({
  AmountInput: (props: any) => {
    const { TouchableOpacity, Text } = require('react-native');
    return (
      <TouchableOpacity testID="cycle" onPress={props.onPressUnit}>
        <Text>{props.amount}</Text>
      </TouchableOpacity>
    );
  },
}));
test('USDC entry emits integer sats; rotating without editing preserves sats', () => {
  const change = jest.fn();
  const ui = render(
    <BtcSendAmountInput
      assetTicker="BTC"
      amount="10000000"
      unit={BitcoinUnit.SATS}
      onChangeText={jest.fn()}
      onAmountUnitChange={jest.fn()}
      onSatsChange={change}
    />,
  );
  fireEvent.press(ui.getByTestId('cycle'));
  expect(ui.getByTestId('SendUsdcInput').props.value).toBe('7330');
  expect(change).not.toHaveBeenCalled();
  fireEvent.press(ui.getByLabelText('Change USDC to BTC'));
  expect(change).toHaveBeenLastCalledWith('10000000', '0.1');
  fireEvent.press(ui.getByTestId('cycle'));
  fireEvent.changeText(ui.getByTestId('SendUsdcInput'), '1');
  expect(change).toHaveBeenLastCalledWith('1364');
  fireEvent.changeText(ui.getByTestId('SendUsdcInput'), 'invalid');
  expect(change).toHaveBeenLastCalledWith('');
});
test('XBT uses existing input without BTC quote entry', () => {
  const ui = render(
    <BtcSendAmountInput
      assetTicker="XBT"
      amount="10"
      unit={BitcoinUnit.SATS}
      onChangeText={jest.fn()}
      onAmountUnitChange={jest.fn()}
      onSatsChange={jest.fn()}
    />,
  );
  fireEvent.press(ui.getByTestId('cycle'));
  expect(ui.queryByTestId('SendUsdcInput')).toBeNull();
});
