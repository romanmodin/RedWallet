import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, NativeModules } from 'react-native';

jest.mock('@react-native-documents/picker', () => ({ types: {} }));
jest.mock('react-native-fs', () => ({}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
}));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
const bridge = {
  run: jest.fn(async () => 'Running'),
  invoice: jest.fn(async (action: string) =>
    action === 'decode' ? { sats: '500', destination: 'test peer', hash: 'reviewed-hash' } : true,
  ),
};
NativeModules.XBTLightningBridge = bridge;
const XBTLightning = require('../../screen/settings/XBTLightning').default;

test('review decodes an invoice without paying; confirmation binds the amount and hash and ignores a repeated tap', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    fireEvent.changeText(screen.getByLabelText('Invoice to pay'), 'lnbcrt-fixture');
    await act(async () => fireEvent.press(screen.getByText('Review invoice')));
    expect(bridge.invoice.mock.calls.map(call => call[0])).toEqual(['decode']);
    fireEvent.press(screen.getByText('Pay 500 sats'));
    const [, detail, buttons] = prompt.mock.calls[0];
    expect(detail).toContain('10 sats');
    const approve = buttons!.find(button => button.text === 'Pay')!.onPress!;
    await act(async () => {
      approve();
      approve();
    });
    expect(bridge.invoice).toHaveBeenCalledWith('pay', 'lnbcrt-fixture', 'reviewed-hash', '500');
    expect(bridge.invoice.mock.calls.map(call => call[0])).toEqual(['decode', 'pay']);
    expect(screen.getByText('Payment settled.')).toBeTruthy();
  } finally {
    prompt.mockRestore();
  }
});

test('unlocked startup refreshes automatically instead of leaving a static screen', async () => {
  jest.useFakeTimers();
  bridge.run.mockResolvedValueOnce('Unlocked').mockResolvedValue('Running');
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    expect(screen.getByText(/Status updates automatically/)).toBeTruthy();
    expect(screen.queryByText('Node and channel balances')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(3000);
    });
    expect(screen.getByText('Node and channel balances')).toBeTruthy();
    screen.unmount();
  } finally {
    jest.useRealTimers();
    bridge.run.mockResolvedValue('Running');
  }
});

test('public node setup defaults to automatic XBT peers and does not request a regtest server', async () => {
  bridge.run.mockClear();
  bridge.run.mockResolvedValueOnce('Stopped').mockResolvedValue('Needs setup');
  try {
    const screen = render(<XBTLightning />);
    await act(async () => {});
    expect(screen.getByLabelText('Optional XBT chain peer').props.value).toBe('');
    expect(screen.queryByText(/Private XBT test network/)).toBeNull();
    await act(async () => fireEvent.press(screen.getByText('Start XBT node')));
    expect(bridge.run).toHaveBeenCalledWith('start', '');
    expect(screen.getByText('Create Lightning wallet')).toBeTruthy();
    screen.unmount();
  } finally {
    bridge.run.mockResolvedValue('Running');
  }
});
