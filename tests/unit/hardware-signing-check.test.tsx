import React from 'react';
import { Text, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import BIP32Factory from 'bip32';
import * as bitcoin from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import HardwareSigningCheck from '../../screen/settings/HardwareSigningCheck';
import { createHardwareSigningFixture, parseHardwareCheckAccount } from '../../class/hardware/offline-signing';

const mockNavigate = jest.fn();
const mockPermission = jest.fn();
let mockFocused = true;
jest.mock('../../hooks/useExtendedNavigation', () => ({ useExtendedNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => mockFocused }));
jest.mock('../../helpers/scan-qr', () => ({ requestCameraAuthorization: () => mockPermission() }));
jest.mock('../../components/themes', () => ({ useTheme: () => ({ colors: { elevated: '#fff' } }) }));
jest.mock('../../components/BlueText', () => ({ __esModule: true, default: (props: any) => <Text {...props} /> }));
jest.mock('../../components/Button', () => ({
  __esModule: true,
  default: (props: any) => (
    <View {...props}>
      <Text>{props.title}</Text>
    </View>
  ),
}));
jest.mock('../../components/BlueSpacing', () => ({ BlueSpacing20: View }));
jest.mock('../../components/DynamicQRCode', () => ({ DynamicQRCode: (props: any) => <View testID="EncodedTestQR" {...props} /> }));

const master = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, 1)); // Public disposable vector only.
const path = "m/84'/0'/0'";
const node = master.derivePath(path);
const account = { fingerprint: Buffer.from(master.fingerprint).toString('hex'), accountPath: path, xpub: node.neutered().toBase58() };
const exportText = JSON.stringify([
  { ExtPubKey: account.xpub, MasterFingerprint: account.fingerprint.toUpperCase(), AccountKeyPath: path },
]);

beforeEach(() => {
  mockNavigate.mockReset();
  mockPermission.mockReset();
  mockPermission.mockResolvedValue('granted');
  mockFocused = true;
});
async function scan(view: ReturnType<typeof render>, button: string) {
  await act(async () => {
    fireEvent.press(view.getByTestId(button));
  });
  expect(mockNavigate).toHaveBeenLastCalledWith('ScanQRCode', expect.objectContaining({ showFileImportButton: true }));
  return mockNavigate.mock.calls[mockNavigate.mock.calls.length - 1][1].onBarScanned as (text: string) => void;
}
async function prepare() {
  const view = render(<HardwareSigningCheck />);
  const receive = await scan(view, 'HardwareCheckScanAccount');
  act(() => receive(exportText));
  expect(view.queryByTestId('EncodedTestQR')).toBeNull();
  fireEvent.press(view.getByTestId('HardwareCheckShowRequest'));
  return view;
}
function sign(view: ReturnType<typeof render>) {
  const hex = view.getByTestId('EncodedTestQR').props.value;
  const psbt = bitcoin.Psbt.fromHex(hex);
  expect(psbt.toHex()).toBe(createHardwareSigningFixture(account).request.toHex());
  return psbt.signInput(0, node.derive(0).derive(0));
}

test('public account → review → QR → valid signed return, using the real offline verifier', async () => {
  const view = await prepare();
  expect(view.getByText('Recipient: 40000 sats')).toBeTruthy();
  expect(view.getByText('Change: 59000 sats')).toBeTruthy();
  expect(view.getByText('Fee: 1000 sats')).toBeTruthy();
  expect(view.getByTestId('EncodedTestQR').props.forceProtocol).toBe('URv2');
  const signed = sign(view);
  const receive = await scan(view, 'HardwareCheckScanSignature');
  act(() => receive(signed.toBase64()));
  expect(view.getByTestId('HardwareCheckPassed')).toBeTruthy();
  expect(view.queryByTestId('HardwareCheckFailed')).toBeNull();
  expect(view.queryByTestId('EncodedTestQR')).toBeNull();
  // A delayed duplicate with bad data cannot overwrite a completed check.
  act(() => receive('bad response'));
  expect(view.getByTestId('HardwareCheckPassed')).toBeTruthy();
});

test('unsigned or changed response cannot show success; a deliberate rescan can recover', async () => {
  const view = await prepare();
  const signed = sign(view);
  const receive = await scan(view, 'HardwareCheckScanSignature');
  act(() => receive(createHardwareSigningFixture(account).request.toBase64()));
  expect(view.queryByTestId('HardwareCheckPassed')).toBeNull();
  expect(view.getByTestId('HardwareCheckFailed')).toBeTruthy();
  const retry = await scan(view, 'HardwareCheckScanSignature');
  expect(view.queryByTestId('HardwareCheckFailed')).toBeNull();
  act(() => retry(signed.toBase64()));
  expect(view.getByTestId('HardwareCheckPassed')).toBeTruthy();
});

test('reset invalidates the original response and removes all displayed account/request data', async () => {
  const view = await prepare();
  const signed = sign(view);
  const receive = await scan(view, 'HardwareCheckScanSignature');
  fireEvent.press(view.getByTestId('HardwareCheckReset'));
  act(() => receive(signed.toBase64()));
  expect(view.queryByTestId('HardwareCheckPassed')).toBeNull();
  expect(view.queryByTestId('HardwareCheckAccount')).toBeNull();
  expect(view.queryByTestId('EncodedTestQR')).toBeNull();
  expect(view.getByTestId('HardwareCheckScanAccount')).toBeTruthy();
});

test('navigation away during camera permission cannot open a late scanner', async () => {
  let settle!: () => void;
  mockPermission.mockReturnValue(
    new Promise<void>(resolve => {
      settle = resolve;
    }),
  );
  const view = render(<HardwareSigningCheck />);
  act(() => {
    fireEvent.press(view.getByTestId('HardwareCheckScanAccount'));
  });
  view.unmount();
  await act(async () => settle());
  expect(mockNavigate).not.toHaveBeenCalled();
});

test('duplicate permission requests are blocked; permission failure stays recoverable', async () => {
  let reject!: (reason: Error) => void;
  mockPermission.mockReturnValue(
    new Promise((_resolve, _reject) => {
      reject = _reject;
    }),
  );
  const view = render(<HardwareSigningCheck />);
  act(() => {
    fireEvent.press(view.getByTestId('HardwareCheckScanAccount'));
    fireEvent.press(view.getByTestId('HardwareCheckScanAccount'));
  });
  expect(mockPermission).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('permission error')));
  expect(view.getByTestId('HardwareCheckError')).toBeTruthy();
  expect(mockNavigate).not.toHaveBeenCalled();
  mockPermission.mockResolvedValue('granted');
  const receive = await scan(view, 'HardwareCheckScanAccount');
  act(() => receive(exportText));
  expect(view.getByTestId('HardwareCheckAccount')).toBeTruthy();
});

test('malformed/private account text never creates a request or echoes the secret', async () => {
  const view = render(<HardwareSigningCheck />);
  const receive = await scan(view, 'HardwareCheckScanAccount');
  act(() => receive(JSON.stringify({ ...account, seed: 'SECRET-MUST-NOT-APPEAR' })));
  expect(view.queryByTestId('HardwareCheckAccount')).toBeNull();
  expect(view.queryByTestId('EncodedTestQR')).toBeNull();
  expect(view.getByTestId('HardwareCheckError')).toBeTruthy();
  expect(JSON.stringify(view.toJSON())).not.toContain('SECRET-MUST-NOT-APPEAR');
});

test('QR animation is unmounted while the scanner covers the check', async () => {
  const view = await prepare();
  mockFocused = false;
  view.rerender(<HardwareSigningCheck />);
  expect(view.queryByTestId('EncodedTestQR')).toBeNull();
  mockFocused = true;
  view.rerender(<HardwareSigningCheck />);
  expect(view.getByTestId('EncodedTestQR')).toBeTruthy();
});

test('parses the real scanner export schema and rejects ambiguity, private or oversized data', () => {
  expect(parseHardwareCheckAccount(exportText)).toEqual(account);
  expect(parseHardwareCheckAccount(JSON.stringify(account))).toEqual(account);
  const row = JSON.parse(exportText)[0];
  expect(parseHardwareCheckAccount(JSON.stringify([{ ...row, AccountKeyPath: "m/49'/0'/0'" }, row]))).toEqual(account);
  for (const value of [
    '',
    'x'.repeat(16385),
    '[]',
    JSON.stringify([row, row]),
    JSON.stringify([{ ...row, ExtPubKey: node.toBase58() }]),
    JSON.stringify([{ ...row, seed: 'secret' }]),
    JSON.stringify([{ ...row, AccountKeyPath: "m/84'/1'/0'" }]),
  ]) {
    expect(() => parseHardwareCheckAccount(value)).toThrow();
  }
});
