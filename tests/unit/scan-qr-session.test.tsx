import React from 'react';
import { View } from 'react-native';
import { act, render } from '@testing-library/react-native';
import { CryptoPSBT } from '@keystonehq/bc-ur-registry';
import BIP32Factory from 'bip32';
import ecc from '../../blue_modules/noble_ecc';
import { createHardwareSigningFixture, verifyHardwareSigningFixture } from '../../scripts/diagnostics/hardware-signing-fixture';
import { splitQRs } from '../../blue_modules/bbqr/split';
import { encodeUR as encodeLegacy } from '../../blue_modules/bc-ur/dist';
import ScanQRCode from '../../screen/send/ScanQRCode';

const mockGoBack = jest.fn();
const mockDispatch = jest.fn();
let mockFocused = true;
let mockOnScanned = jest.fn();
const mockFilePicker = jest.fn();
const mockImagePicker = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockFocused,
  useRoute: () => ({
    params: { onBarScanned: mockOnScanned, showFileImportButton: true },
  }),
  StackActions: { popTo: jest.fn() },
}));
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => ({
    goBack: mockGoBack,
    dispatch: mockDispatch,
    getState: () => ({
      routes: [{ name: 'PsbtWithHardwareWallet' }, { name: 'ScanQRCode' }],
    }),
  }),
}));
jest.mock('../../helpers/scan-qr', () => ({
  isCameraAuthorizationStatusGranted: async () => true,
}));
jest.mock('../../blue_modules/fs', () => ({
  showFilePickerAndReadFile: () => mockFilePicker(),
  showImagePickerAndReadImage: () => mockImagePicker(),
}));
jest.mock('../../class/camera', () => ({
  openPrivacyDesktopSettings: jest.fn(),
}));
jest.mock('../../components/CameraScreen', () => ({
  __esModule: true,
  default: (props: any) => <View testID="Camera" {...props} />,
}));
jest.mock('../../components/SafeArea', () => ({
  __esModule: true,
  default: View,
}));
jest.mock('../../components/BlueText', () => ({
  __esModule: true,
  default: require('react-native').Text,
}));
jest.mock('../../components/Button', () => ({
  __esModule: true,
  default: View,
}));
jest.mock('../../components/BlueSpacing', () => ({ BlueSpacing40: View }));
jest.mock('../../components/BlueLoading', () => ({
  BlueLoading: () => <View testID="Loading" />,
}));
jest.mock('../../components/themes', () => ({
  useTheme: () => ({ colors: {} }),
}));
jest.mock('../../class/multisig-cosigner', () => ({
  MultisigCosigner: class {
    isValid() {
      return false;
    }
  },
}));
jest.mock('../../class/wallets/multisig-hd-wallet', () => ({
  MultisigHDWallet: {
    PATH_LEGACY: "m/45'",
    PATH_WRAPPED_SEGWIT: "m/48'/0'/0'/1'",
    PATH_NATIVE_SEGWIT: "m/48'/0'/0'/2'",
  },
}));

// Public disposable test keys; never a user account or real funds.
function fixture(seed: number) {
  const master = BIP32Factory(ecc).fromSeed(Buffer.alloc(32, seed));
  const accountPath = "m/84'/0'/0'";
  const node = master.derivePath(accountPath);
  const account = {
    fingerprint: Buffer.from(master.fingerprint).toString('hex'),
    accountPath,
    xpub: node.neutered().toBase58(),
  };
  const signed = createHardwareSigningFixture(account).request.signInput(0, node.derive(0).derive(0));
  const encoder = new CryptoPSBT(Buffer.from(signed.toBuffer())).toUREncoder(120);
  const parts = Array.from({ length: encoder.fragmentsLength }, () => encoder.nextPart().toUpperCase());
  return { account, signed, parts };
}
const first = fixture(1);
const second = fixture(2);

async function open() {
  const view = render(<ScanQRCode />);
  await act(async () => {});
  return view;
}
function feed(view: Awaited<ReturnType<typeof open>>, data: unknown) {
  const handler = view.getByTestId('Camera').props.onReadCode;
  act(() => handler({ nativeEvent: { codeStringValue: data } }));
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocused = true;
  mockOnScanned = jest.fn();
  mockFilePicker.mockReset();
  mockImagePicker.mockReset();
});

test('actual animated signed PSBT yields one exact verified result despite repeats and rerenders', async () => {
  const view = await open();
  const handler = view.getByTestId('Camera').props.onReadCode;
  for (const part of [...first.parts].reverse()) {
    feed(view, part);
    view.rerender(<ScanQRCode />);
  }
  act(() => {
    for (const part of first.parts) handler({ nativeEvent: { codeStringValue: part } });
  });
  expect(mockOnScanned).toHaveBeenCalledTimes(1);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
  const returned = mockOnScanned.mock.calls[0][0];
  expect(returned).toBe(first.signed.toBase64());
  expect(verifyHardwareSigningFixture(first.account, Buffer.from(returned))).toMatchObject({
    status: 'offline-fixture-signature-verified',
  });
});

test('canceling a partial animated scan cannot poison the next hardware transaction', async () => {
  const a = await open();
  feed(a, first.parts[0]);
  act(() => a.getByTestId('Camera').props.onCancelButtonPress());
  a.unmount();
  mockGoBack.mockClear();
  const b = await open();
  for (const part of second.parts) feed(b, part);
  expect(mockOnScanned).toHaveBeenCalledTimes(1);
  expect(mockOnScanned).toHaveBeenCalledWith(second.signed.toBase64(), false);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

test('blur discards partial state and rejects late events before a new focus session', async () => {
  const view = await open();
  const stale = view.getByTestId('Camera').props.onReadCode;
  feed(view, first.parts[0]);
  mockFocused = false;
  view.rerender(<ScanQRCode />);
  act(() => {
    for (const part of first.parts) stale({ nativeEvent: { codeStringValue: part } });
  });
  expect(mockOnScanned).not.toHaveBeenCalled();
  mockFocused = true;
  view.rerender(<ScanQRCode />);
  for (const part of second.parts) feed(view, part);
  expect(mockOnScanned).toHaveBeenCalledWith(second.signed.toBase64(), false);
});

test('ordinary QR invokes the recipient once even when the callback reenters and React rerenders', async () => {
  const view = await open();
  const handler = view.getByTestId('Camera').props.onReadCode;
  mockOnScanned.mockImplementation(() => handler({ nativeEvent: { codeStringValue: 'second callback' } }));
  feed(view, 'first callback');
  view.rerender(<ScanQRCode />);
  act(() => handler({ nativeEvent: { codeStringValue: 'third callback' } }));
  expect(mockOnScanned).toHaveBeenCalledTimes(1);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

test('empty or malformed native camera events are ignored', async () => {
  const view = await open();
  const handler = view.getByTestId('Camera').props.onReadCode;
  for (const event of [
    undefined,
    {},
    { nativeEvent: {} },
    { nativeEvent: { codeStringValue: 7 } },
    { nativeEvent: { codeStringValue: '' } },
  ]) {
    expect(() => act(() => handler(event))).not.toThrow();
  }
  expect(mockOnScanned).not.toHaveBeenCalled();
});

test('file picker can deliver an ordinary signed PSBT while loading', async () => {
  mockFilePicker.mockResolvedValue({ data: first.signed.toBase64() });
  const view = await open();
  await act(async () => {
    await view.getByTestId('Camera').props.onFilePickerButtonPress();
  });
  expect(mockOnScanned).toHaveBeenCalledWith(first.signed.toBase64(), false);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

test.each(['file', 'image'])('late %s picker result cannot complete a canceled scanner', async mode => {
  let settle!: (value: any) => void;
  const pending = new Promise(resolve => {
    settle = resolve;
  });
  (mode === 'file' ? mockFilePicker : mockImagePicker).mockReturnValue(pending);
  const view = await open();
  const camera = view.getByTestId('Camera').props;
  let picker!: Promise<unknown>;
  act(() => {
    picker = mode === 'file' ? camera.onFilePickerButtonPress() : camera.onImagePickerButtonPress();
  });
  act(() => camera.onCancelButtonPress());
  view.unmount();
  await act(async () => {
    settle(mode === 'file' ? { data: first.signed.toBase64() } : first.signed.toBase64());
    await picker;
  });
  expect(mockOnScanned).not.toHaveBeenCalled();
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});

test('old camera handlers remain closed even after the same route regains focus', async () => {
  const view = await open();
  const old = view.getByTestId('Camera').props.onReadCode;
  feed(view, first.parts[0]);
  mockFocused = false;
  view.rerender(<ScanQRCode />);
  mockFocused = true;
  view.rerender(<ScanQRCode />);
  act(() => {
    for (const part of first.parts) old({ nativeEvent: { codeStringValue: part } });
  });
  expect(mockOnScanned).not.toHaveBeenCalled();
  for (const part of second.parts) feed(view, part);
  expect(mockOnScanned).toHaveBeenCalledWith(second.signed.toBase64(), false);
});

test.each(['BBQR', 'URv1'])('retains real %s multipart PSBT support with duplicates', async protocol => {
  const parts =
    protocol === 'BBQR'
      ? splitQRs(first.signed.toBuffer(), 'P', { minVersion: 1, maxVersion: 10, minSplit: 2, encoding: 'H' }).parts
      : encodeLegacy(first.signed.toHex(), 120);
  const view = await open();
  for (const part of [...parts].reverse()) {
    feed(view, part);
    feed(view, part);
  }
  expect(mockOnScanned).toHaveBeenCalledTimes(1);
  expect(mockOnScanned).toHaveBeenCalledWith(first.signed.toBase64(), protocol === 'BBQR');
});

test.each(['file', 'image'])('%s picker rejection restores the current camera', async mode => {
  (mode === 'file' ? mockFilePicker : mockImagePicker).mockRejectedValue(new Error('canceled'));
  const view = await open();
  const camera = view.getByTestId('Camera').props;
  await act(async () => {
    await (mode === 'file' ? camera.onFilePickerButtonPress() : camera.onImagePickerButtonPress());
  });
  expect(view.getByTestId('Camera')).toBeTruthy();
  feed(view, 'ordinary QR after picker cancellation');
  expect(mockOnScanned).toHaveBeenCalledTimes(1);
});

test('two mounted scanners never share unfinished fountain fragments', async () => {
  const a = await open();
  feed(a, first.parts[0]);
  const handlerA = a.getByTestId('Camera').props.onReadCode;
  const b = await open();
  const handlerB = b.getByTestId('Camera').props.onReadCode;
  act(() => {
    for (const part of second.parts) handlerB({ nativeEvent: { codeStringValue: part } });
  });
  expect(mockOnScanned).toHaveBeenCalledWith(second.signed.toBase64(), false);
  act(() => {
    for (const part of first.parts.slice(1)) handlerA({ nativeEvent: { codeStringValue: part } });
  });
  expect(mockOnScanned).toHaveBeenCalledTimes(2);
  expect(mockOnScanned).toHaveBeenLastCalledWith(first.signed.toBase64(), false);
});

test('a throwing consumer cannot crash the scanner or cause a second delivery', async () => {
  mockOnScanned.mockImplementation(() => {
    throw new Error('private contents must not be logged');
  });
  const view = await open();
  const handler = view.getByTestId('Camera').props.onReadCode;
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(() => feed(view, 'ordinary code')).not.toThrow();
    act(() => handler({ nativeEvent: { codeStringValue: 'late code' } }));
    expect(mockOnScanned).toHaveBeenCalledTimes(1);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('private contents');
  } finally {
    warning.mockRestore();
  }
});
