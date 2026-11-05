import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NativeModules } from 'react-native';
import XBTLightningChannelFunds from '../../components/XBTLightningChannelFunds';
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
const bridge = { splice: jest.fn() };
NativeModules.XBTLightningBridge = bridge;
const point = 'test-channel:0';
const ready = {
  status: 'ok',
  progress: '',
  txid: '',
  confirmations: '0',
  lockDepth: '0',
};
const run = async (_: string, action: () => Promise<void>) => {
  await action();
};
const report = jest.fn();
const onUpdated = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
});
function screen(status = 'ok') {
  return render(
    <XBTLightningChannelFunds
      point={point}
      active
      splice={{ ...ready, status }}
      busy={false}
      run={run}
      report={report}
      onUpdated={onUpdated}
    />,
  );
}
function review(direction: string) {
  return {
    token: 'token',
    point,
    direction,
    address: direction === 'out' ? 'bc1-own-wallet' : '',
    sats: '20000',
    feeRate: '2',
    fee: '400',
    capacity: '120000',
    local: '110000',
    lockDepth: '6',
  };
}
test.each([
  ['in', 'Add funds', 'Confirm add funds'],
  ['out', 'Remove funds', 'Confirm remove funds'],
])('%s reviews before execution and consumes a token once', async (direction, button, confirm) => {
  bridge.splice.mockResolvedValueOnce(review(direction)).mockResolvedValue('Resize preparing.');
  const s = screen();
  fireEvent.press(s.getByText(button));
  fireEvent.changeText(s.getByLabelText('Channel resize sats'), '20000');
  fireEvent.changeText(s.getByLabelText('Channel resize fee rate'), '2');
  await act(async () => fireEvent.press(s.getByText('Review channel resize')));
  expect(bridge.splice).toHaveBeenCalledTimes(1);
  expect(bridge.splice).toHaveBeenCalledWith('review', JSON.stringify({ point, direction, sats: '20000', feeRate: '2' }));
  expect(s.getByText(/Estimated network fee: 400 sats/)).toBeTruthy();
  if (direction === 'out') expect(s.getByText(/Return address: bc1-own-wallet/)).toBeTruthy();
  const press = s.getByText(confirm);
  await act(async () => {
    fireEvent.press(press);
    fireEvent.press(press);
  });
  expect(bridge.splice.mock.calls.filter(c => c[0] === 'confirm')).toEqual([['confirm', 'token']]);
  expect(onUpdated).toHaveBeenCalledTimes(1);
});
test('editing or cancelling invalidates the review without a transaction', async () => {
  bridge.splice.mockResolvedValue(review('in'));
  const s = screen();
  fireEvent.press(s.getByText('Add funds'));
  fireEvent.changeText(s.getByLabelText('Channel resize sats'), '20000');
  fireEvent.changeText(s.getByLabelText('Channel resize fee rate'), '2');
  await act(async () => fireEvent.press(s.getByText('Review channel resize')));
  fireEvent.changeText(s.getByLabelText('Channel resize sats'), '30000');
  expect(s.queryByText('Confirm add funds')).toBeNull();
  fireEvent.press(s.getByText('Cancel resize review'));
  expect(s.queryByLabelText('Channel resize sats')).toBeNull();
  expect(bridge.splice).toHaveBeenCalledTimes(1);
});
test('unsupported peers do not request or execute a resize', () => {
  const s = screen('peer_unsupported');
  fireEvent.press(s.getByText('Add funds'));
  expect(s.getByText('This peer does not support splicing.')).toBeTruthy();
  expect(s.queryByLabelText('Channel resize sats')).toBeNull();
  expect(bridge.splice).not.toHaveBeenCalled();
});
test('a failed confirmation is not retried automatically', async () => {
  bridge.splice.mockResolvedValueOnce(review('out')).mockRejectedValueOnce(new Error('lost connection'));
  const s = screen();
  fireEvent.press(s.getByText('Remove funds'));
  fireEvent.changeText(s.getByLabelText('Channel resize sats'), '20000');
  fireEvent.changeText(s.getByLabelText('Channel resize fee rate'), '2');
  await act(async () => fireEvent.press(s.getByText('Review channel resize')));
  await act(async () => fireEvent.press(s.getByText('Confirm remove funds')));
  expect(report).toHaveBeenLastCalledWith(expect.stringContaining('outcome unknown'));
  expect(bridge.splice.mock.calls.filter(c => c[0] === 'confirm')).toHaveLength(1);
  expect(s.queryByText('Confirm remove funds')).toBeNull();
});
