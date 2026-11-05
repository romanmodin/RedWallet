import Clipboard from '@react-native-clipboard/clipboard';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Share, StyleSheet } from 'react-native';

import XBTLightningInvoice from '../../components/XBTLightningInvoice';

jest.mock('../../components/QRCode', () => {
  const { View } = jest.requireActual('react-native');
  return ({ value, size, ...props }: { value: string; size: number }) => (
    <View testID="EncodedInvoiceQR" value={value} size={size} {...props} />
  );
});
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});

// Long feature vectors and route hints must not dominate the initial screen.
const invoice = 'lnbc10m1' + 'q'.repeat(800) + 'end';

test('long invoice is collapsed; QR fits a narrow card and leaves scroll gestures to its parent', () => {
  const screen = render(<XBTLightningInvoice invoice={invoice} sats="1000000" />);
  expect(screen.queryByText(invoice)).toBeNull();
  expect(screen.getByText('Receive 1000000 sats')).toBeTruthy();
  fireEvent(screen.getByTestId('XBTLightningReceiveInvoice'), 'layout', {
    nativeEvent: { layout: { width: 288 } },
  });
  const qr = screen.getByTestId('EncodedInvoiceQR');
  expect(qr.props.value.toLowerCase()).toBe(invoice);
  expect(qr.props.size).toBeLessThanOrEqual(288 - 32);
  expect(qr.props.isLogoRendered).toBe(false);
  expect(qr.props.isMenuAvailable).toBe(false);
  expect(screen.getByTestId('XBTLightningInvoiceQR').props.pointerEvents).toBe('none');

  fireEvent.press(screen.getByLabelText('Show invoice text'));
  const text = screen.getByTestId('XBTLightningInvoiceText');
  expect(text.props.children).toBe(invoice);
  expect(text.props.selectable).toBe(false);
  expect(text.props.numberOfLines).toBe(8);
  expect(screen.queryByTestId('EncodedInvoiceQR')).toBeNull();
  expect(StyleSheet.flatten(text.props.style).fontSize).toBe(12);
  fireEvent.press(screen.getByLabelText('Show invoice QR code'));
  expect(screen.queryByText(invoice)).toBeNull();
  expect(screen.getByTestId('EncodedInvoiceQR').props.value.toLowerCase()).toBe(invoice);
});

test('copy and share preserve the entire original invoice with text collapsed', async () => {
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  try {
    const screen = render(<XBTLightningInvoice invoice={invoice} sats="1000000" />);
    fireEvent.press(screen.getByText('Copy invoice'));
    expect(Clipboard.setString).toHaveBeenLastCalledWith(invoice);
    expect(screen.getByText('Invoice copied')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByText('Share invoice')));
    expect(share).toHaveBeenCalledWith({ message: invoice });
    expect(screen.queryByText(invoice)).toBeNull();
  } finally {
    share.mockRestore();
  }
});

test('share failure offers copy without losing the invoice', async () => {
  const share = jest.spyOn(Share, 'share').mockRejectedValue(new Error('Unavailable'));
  try {
    const screen = render(<XBTLightningInvoice invoice={invoice} sats="1000000" />);
    await act(async () => fireEvent.press(screen.getByText('Share invoice')));
    expect(screen.getByText(/Could not open sharing/)).toBeTruthy();
    fireEvent.press(screen.getByText('Copy invoice'));
    expect(Clipboard.setString).toHaveBeenLastCalledWith(invoice);
  } finally {
    share.mockRestore();
  }
});
