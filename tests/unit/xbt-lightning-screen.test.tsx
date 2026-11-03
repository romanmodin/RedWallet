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
    fireEvent.changeText(screen.getByLabelText('Test invoice to pay'), 'lnbcrt-fixture');
    await act(async () => fireEvent.press(screen.getByText('Review test invoice')));
    expect(bridge.invoice.mock.calls.map(call => call[0])).toEqual(['decode']);
    fireEvent.press(screen.getByText('Pay 500 test sats'));
    const [, detail, buttons] = prompt.mock.calls[0];
    expect(detail).toContain('10 test sats');
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
