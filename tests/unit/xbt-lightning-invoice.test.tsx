import Clipboard from '@react-native-clipboard/clipboard';
import { encodeQR } from 'qr';
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform, Share, StyleSheet } from 'react-native';
import RNFS from 'react-native-fs';
import NativeShare from 'react-native-share';

import XBTLightningInvoice from '../../components/XBTLightningInvoice';

jest.mock('react-native-image-picker', () => ({}));
jest.mock('../../blue_modules/environment', () => ({ isDesktop: false }));
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

test.each(['invoice', 'offer'] as const)('shares the selected %s format and keeps copy exact', async kind => {
  const request = kind === 'offer' ? 'lno1' + 'q'.repeat(400) : invoice;
  const textShare = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  try {
    jest.mocked(NativeShare.open).mockClear();
    jest.mocked(RNFS.writeFile).mockClear();
    const screen = render(<XBTLightningInvoice invoice={request} sats="1000" kind={kind} />);
    fireEvent.press(screen.getByText('Copy ' + kind));
    expect(Clipboard.setString).toHaveBeenLastCalledWith(request);

    await act(async () => fireEvent.press(screen.getByText('Share QR image')));
    const [path, data, encoding] = jest.mocked(RNFS.writeFile).mock.calls[0];
    expect(path).toMatch(new RegExp('xbt-lightning-' + kind + '\\.gif$'));
    expect(encoding).toBe('base64');
    const sharedImage = Buffer.from(data, 'base64');
    expect(sharedImage.subarray(0, 3).toString()).toBe('GIF');
    expect(sharedImage.equals(Buffer.from(encodeQR(request.toUpperCase(), 'gif', { ecc: 'medium', border: 4, scale: 8 })))).toBe(true);
    expect(NativeShare.open).toHaveBeenCalledWith(expect.objectContaining({ url: 'file://' + path }));
    expect(textShare).not.toHaveBeenCalled();

    fireEvent.press(screen.getByText('Switch to text'));
    expect(screen.getByTestId('XBTLightningInvoiceText').props.children).toBe(request);
    await act(async () => fireEvent.press(screen.getByText('Share ' + kind + ' text')));
    expect(textShare).toHaveBeenCalledWith({ message: request });
    expect(NativeShare.open).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByText('Switch to QR'));
    await act(async () => fireEvent.press(screen.getByText('Share QR image')));
    expect(NativeShare.open).toHaveBeenCalledTimes(2);
    expect(textShare).toHaveBeenCalledTimes(1);
  } finally {
    textShare.mockRestore();
  }
});

test('Android shares an image attachment without invoice text', async () => {
  const os = jest.replaceProperty(Platform, 'OS', 'android');
  try {
    const screen = render(<XBTLightningInvoice invoice={invoice} sats="1000000" />);
    await act(async () => fireEvent.press(screen.getByText('Share QR image')));
    expect(NativeShare.open).toHaveBeenLastCalledWith({
      url: expect.stringMatching(/^data:image\/gif;base64,R0lG/),
      type: 'image/gif',
      useInternalStorage: true,
      failOnCancel: false,
    });
  } finally {
    os.restore();
  }
});

test('share failure offers copy without losing the invoice', async () => {
  const share = jest.spyOn(Share, 'share').mockRejectedValue(new Error('Unavailable'));
  try {
    const screen = render(<XBTLightningInvoice invoice={invoice} sats="1000000" />);
    fireEvent.press(screen.getByLabelText('Show invoice text'));
    await act(async () => fireEvent.press(screen.getByText('Share invoice text')));
    expect(screen.getByText(/Could not open sharing/)).toBeTruthy();
    fireEvent.press(screen.getByText('Copy invoice'));
    expect(Clipboard.setString).toHaveBeenLastCalledWith(invoice);
  } finally {
    share.mockRestore();
  }
});

test.each(['file write', 'share sheet'])('iOS QR %s failure cleans up the file and offers Copy', async failure => {
  jest.mocked(RNFS.exists).mockResolvedValueOnce(true);
  if (failure === 'file write') {
    jest.mocked(RNFS.writeFile).mockRejectedValueOnce(new Error('Write failed'));
  } else {
    jest.mocked(NativeShare.open).mockRejectedValueOnce(new Error('Share failed'));
  }
  const screen = render(<XBTLightningInvoice invoice={invoice} sats="1000000" />);
  await act(async () => fireEvent.press(screen.getByText('Share QR image')));
  expect(screen.getByText(/Could not open sharing/)).toBeTruthy();
  const path = jest.mocked(RNFS.writeFile).mock.lastCall?.[0];
  expect(RNFS.unlink).toHaveBeenLastCalledWith(path);
  fireEvent.press(screen.getByText('Copy invoice'));
  expect(Clipboard.setString).toHaveBeenLastCalledWith(invoice);
});

test('canceling the iOS share sheet quietly removes the temporary QR', async () => {
  jest.mocked(RNFS.exists).mockResolvedValueOnce(true);
  jest.mocked(NativeShare.open).mockRejectedValueOnce(new Error('CANCELLED'));
  const screen = render(<XBTLightningInvoice invoice={invoice} sats="1000000" />);
  await act(async () => fireEvent.press(screen.getByText('Share QR image')));
  expect(screen.queryByText(/Could not open sharing/)).toBeNull();
  expect(RNFS.unlink).toHaveBeenLastCalledWith(jest.mocked(RNFS.writeFile).mock.lastCall?.[0]);
});

test('requests too large for an image can still be shared as complete text', async () => {
  const longRequest = 'lnbc1' + 'q'.repeat(6000);
  const share = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
  try {
    const screen = render(<XBTLightningInvoice invoice={longRequest} sats="500" />);
    await act(async () => fireEvent.press(screen.getByText('Share QR image')));
    expect(screen.getByText(/Could not open sharing/)).toBeTruthy();
    expect(share).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Switch to text'));
    await act(async () => fireEvent.press(screen.getByText('Share invoice text')));
    expect(share).toHaveBeenCalledWith({ message: longRequest });
  } finally {
    share.mockRestore();
  }
});
