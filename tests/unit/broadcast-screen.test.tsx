import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as bitcoin from 'bitcoinjs-lib';
import Broadcast, { Sha256Broadcast } from '../../screen/send/Broadcast';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import presentAlert from '../../components/Alert';
import { majorTomToGroundControl } from '../../blue_modules/notifications';
import loc from '../../loc';

const mockSha256Broadcast = jest.fn();
const mockSha256Wallet = jest.fn((_id: string) => ({
  broadcastV2: mockSha256Broadcast,
}));
jest.mock('../../blue_modules/BtcElectrum', () => ({
  forWallet: (id: string) => mockSha256Wallet(id),
}));
jest.mock('../../blue_modules/BlueElectrum', () => ({
  ensureConnected: jest.fn(),
}));
jest.mock('../../class/wallets/hd-segwit-bech32-wallet', () => ({
  HDSegwitBech32Wallet: jest.fn().mockImplementation(() => ({ broadcastTx: mockBroadcastTx })),
}));
jest.mock('../../components/Alert', () => jest.fn());
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: { NotificationSuccess: 'notificationSuccess', NotificationError: 'notificationError' },
}));
jest.mock('../../blue_modules/notifications', () => ({ majorTomToGroundControl: jest.fn() }));
jest.mock('../../helpers/scan-qr', () => ({ scanQrHelper: jest.fn() }));
jest.mock('../../components/BlueBigCheckmark', () => ({ BlueBigCheckmark: () => null }));
jest.mock('../../components/themes', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('../../components/SettingsSection', () => {
  const { View } = require('react-native');
  return { SettingsScrollView: View, SettingsSection: View, settingsCardContent: {} };
});
jest.mock('../../components/Button', () => {
  const { Pressable, Text } = require('react-native');
  return ({ title, ...props }: any) => (
    <Pressable {...props}>
      <Text>{title}</Text>
    </Pressable>
  );
});

const mockBroadcastTx = jest.fn();
const transaction = new bitcoin.Transaction();
transaction.addInput(new Uint8Array(32).fill(1), 0);
transaction.addOutput(new Uint8Array([0x51]), 1000n);
const hex = transaction.toHex();

beforeEach(() => {
  jest.clearAllMocks();
  (BlueElectrum.ensureConnected as jest.Mock).mockResolvedValue(true);
  mockBroadcastTx.mockResolvedValue(true);
});

function submit(input: string) {
  const view = render(<Broadcast />);
  fireEvent.changeText(view.getByTestId('TxHex'), input);
  fireEvent.press(view.getByTestId('BroadcastButton'));
  return view;
}

test.each(['invalid', '0', '00', hex.slice(0, -2), hex + '00', hex + 'f', hex + 'xx'])(
  'rejects malformed transaction %s locally even when the server cannot respond',
  async input => {
    (BlueElectrum.ensureConnected as jest.Mock).mockImplementation(() => new Promise(() => {}));
    const view = submit(input);
    await waitFor(() => expect(presentAlert).toHaveBeenCalled());
    expect(view.getByText(loc.send.broadcastError)).toBeTruthy();
    expect(BlueElectrum.ensureConnected).not.toHaveBeenCalled();
    expect(mockBroadcastTx).not.toHaveBeenCalled();
    expect(majorTomToGroundControl).not.toHaveBeenCalled();
  },
);

test('empty or whitespace-only input cannot start a broadcast', () => {
  const view = render(<Broadcast />);
  fireEvent.press(view.getByTestId('BroadcastButton'));
  fireEvent.changeText(view.getByTestId('TxHex'), '  \n ');
  fireEvent.press(view.getByTestId('BroadcastButton'));
  expect(BlueElectrum.ensureConnected).not.toHaveBeenCalled();
  expect(mockBroadcastTx).not.toHaveBeenCalled();
});

test('valid input still requires connectivity before broadcasting', async () => {
  (BlueElectrum.ensureConnected as jest.Mock).mockResolvedValue(false);
  const view = submit(hex);
  await waitFor(() => expect(presentAlert).toHaveBeenCalledWith({ title: loc.errors.error, message: loc.errors.network }));
  expect(view.getByText(loc.send.broadcastError)).toBeTruthy();
  expect(mockBroadcastTx).not.toHaveBeenCalled();
  expect(majorTomToGroundControl).not.toHaveBeenCalled();
});

test('broadcasts the exact validated bytes once and waits for acceptance before success', async () => {
  let finish!: (accepted: boolean) => void;
  mockBroadcastTx.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  const input = hex.toUpperCase();
  const view = submit('  ' + input + '\n');
  await waitFor(() => expect(mockBroadcastTx).toHaveBeenCalledWith(input));
  expect(view.getByText(loc.send.broadcastPending)).toBeTruthy();
  expect(majorTomToGroundControl).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('BroadcastButton'));
  expect(mockBroadcastTx).toHaveBeenCalledTimes(1);
  await act(async () => finish(true));
  expect(view.getByText(transaction.getId())).toBeTruthy();
  expect(majorTomToGroundControl).toHaveBeenCalledWith([], [], [transaction.getId()]);
});

test.each([false, new Error('Server rejected transaction')])('never shows success when broadcasting fails: %s', async outcome => {
  if (outcome instanceof Error) mockBroadcastTx.mockRejectedValueOnce(outcome);
  else mockBroadcastTx.mockResolvedValueOnce(outcome);
  const view = submit(hex);
  await waitFor(() => expect(view.getByText(loc.send.broadcastError)).toBeTruthy());
  expect(view.queryByText(transaction.getId())).toBeNull();
  expect(majorTomToGroundControl).not.toHaveBeenCalled();
  expect(mockBroadcastTx).toHaveBeenCalledTimes(1);
});

test.each([true, false])('SHA-256 tool uses only the selected wallet and displays its result (accepted=%s)', async accepted => {
  if (accepted) mockSha256Broadcast.mockResolvedValueOnce(transaction.getId());
  else mockSha256Broadcast.mockRejectedValueOnce(new Error('SHA-256 server rejected transaction'));
  const screen = render(<Sha256Broadcast route={{ params: { walletID: 'blue-wallet' } }} />);
  fireEvent.changeText(screen.getByTestId('TxHex'), hex);
  fireEvent.press(screen.getByText(loc.send.broadcast_sha256));
  await waitFor(() => expect(screen.getByText(accepted ? transaction.getId() : loc.send.broadcastError)).toBeTruthy());
  expect(mockSha256Wallet).toHaveBeenCalledWith('blue-wallet');
  expect(mockSha256Broadcast).toHaveBeenCalledWith(hex);
  expect(BlueElectrum.ensureConnected).not.toHaveBeenCalled();
  expect(mockBroadcastTx).not.toHaveBeenCalled();
  expect(majorTomToGroundControl).not.toHaveBeenCalled();
  expect(screen.queryByText(loc.settings.open_link_in_explorer)).toBeNull();
});
