import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Btc from '../../blue_modules/BtcElectrum';
import presentAlert from '../../components/Alert';

const mockNavigation = { navigate: jest.fn() };
jest.mock('../../hooks/useExtendedNavigation', () => ({
  useExtendedNavigation: () => mockNavigation,
}));
jest.mock('../../blue_modules/notifications', () => ({
  isNotificationsCapable: false,
}));
jest.mock('../../components/themes', () => ({
  useTheme: () => ({ colors: {} }),
}));
jest.mock('../../components/Alert', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../blue_modules/BtcElectrum', () => ({
  ...jest.requireActual('../../blue_modules/BtcElectrum'),
  getPreferredServer: jest.fn(),
  setPreferredServer: jest.fn(),
  resetPreferredServer: jest.fn(),
}));
jest.mock('../../components/Button', () => {
  const { Pressable, Text } = require('react-native');
  return ({ title, ...props }: any) => (
    <Pressable {...props}>
      <Text>{title}</Text>
    </Pressable>
  );
});
jest.mock('../../components/SettingsSection', () => {
  const { View, Text, Pressable, Switch } = require('react-native');
  return {
    SettingsSection: ({ children }: any) => <View>{children}</View>,
    SettingsScrollView: View,
    SettingsFootnote: Text,
    settingsCardContent: {},
    SettingsListItem: ({ title, subtitle, onPress, switch: switchProps, disabled, testID }: any) => (
      <Pressable onPress={onPress} disabled={disabled} testID={testID}>
        <Text>{title}</Text>
        <Text>{subtitle}</Text>
        {switchProps ? <Switch {...switchProps} /> : null}
      </Pressable>
    ),
  };
});
const BtcElectrumSettings = require('../../screen/settings/BtcElectrumSettings').default;
const NetworkSettings = require('../../screen/settings/NetworkSettings').default;

beforeEach(() => {
  jest.clearAllMocks();
  (Btc.getPreferredServer as jest.Mock).mockResolvedValue({
    host: 'private.server',
    ssl: 51002,
  });
  (Btc.setPreferredServer as jest.Mock).mockResolvedValue(undefined);
  (Btc.resetPreferredServer as jest.Mock).mockResolvedValue(undefined);
});

test('Network settings route Bitcoin and XBT to separate screens', () => {
  const screen = render(<NetworkSettings />);
  fireEvent.press(screen.getByTestId('BtcElectrumSettings'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('BtcElectrumSettings');
  fireEvent.press(screen.getByTestId('ElectrumSettings'));
  expect(mockNavigation.navigate).toHaveBeenLastCalledWith('ElectrumSettings');
});

test('opening BTC settings loads the saved server without any network test or write', async () => {
  const screen = render(<BtcElectrumSettings />);
  await act(async () => {});
  expect(screen.getByTestId('BtcServerHost').props.value).toBe('private.server');
  expect(screen.getByTestId('BtcServerPort').props.value).toBe('51002');
  expect(screen.getByTestId('BtcServerSSL').props.value).toBe(true);
  expect(Btc.setPreferredServer).not.toHaveBeenCalled();
  expect(Btc.resetPreferredServer).not.toHaveBeenCalled();
});

test('a failed Bitcoin chain check leaves the form intact and reports that the server was not saved', async () => {
  (Btc.setPreferredServer as jest.Mock).mockRejectedValueOnce(new Error('This server is not on the Bitcoin SHA-256 chain.'));
  const screen = render(<BtcElectrumSettings />);
  await act(async () => {});
  fireEvent.changeText(screen.getByTestId('BtcServerHost'), 'wrong.chain');
  await act(async () => fireEvent.press(screen.getByTestId('SaveBtcServer')));
  expect(presentAlert).toHaveBeenCalledWith({
    title: 'BTC server not saved',
    message: expect.stringContaining('not on the Bitcoin'),
  });
  expect(screen.getByTestId('BtcServerHost').props.value).toBe('wrong.chain');
  expect(Btc.resetPreferredServer).not.toHaveBeenCalled();
});

test('SSL is explicit; saving a TCP choice drops the inactive certificate field', async () => {
  const screen = render(<BtcElectrumSettings />);
  await act(async () => {});
  fireEvent.changeText(screen.getByTestId('BtcServerCertificate'), 'inactive old certificate');
  fireEvent(screen.getByTestId('BtcServerSSL'), 'valueChange', false);
  expect(screen.queryByTestId('BtcServerCertificate')).toBeNull();
  expect(screen.getByTestId('BtcServerPlaintextNotice')).toBeTruthy();
  fireEvent.changeText(screen.getByTestId('BtcServerPort'), '50001');
  await act(async () => fireEvent.press(screen.getByTestId('SaveBtcServer')));
  expect(Btc.setPreferredServer).toHaveBeenCalledWith({
    host: 'private.server',
    tcp: 50001,
  });
  expect(presentAlert).toHaveBeenCalledWith({
    title: 'BTC server saved',
    message: expect.stringContaining('blue BTC wallet'),
  });
});

test('a storage read failure does not silently fill or save the public default', async () => {
  (Btc.getPreferredServer as jest.Mock).mockRejectedValueOnce(new Error('cannot read'));
  const screen = render(<BtcElectrumSettings />);
  await act(async () => {});
  expect(screen.getByTestId('BtcServerLoadError')).toBeTruthy();
  expect(screen.getByTestId('BtcServerHost').props.value).toBe('');
  expect(Btc.setPreferredServer).not.toHaveBeenCalled();
  await act(async () => fireEvent.press(screen.getByTestId('ResetBtcServer')));
  expect(Btc.resetPreferredServer).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('BtcServerHost').props.value).toBe('electrum.blockstream.info');
  expect(screen.getByTestId('BtcServerSSL').props.value).toBe(true);
});

test('failed reset does not display the default as if it had been saved', async () => {
  (Btc.resetPreferredServer as jest.Mock).mockRejectedValueOnce(new Error('cannot write'));
  const screen = render(<BtcElectrumSettings />);
  await act(async () => {});
  await act(async () => fireEvent.press(screen.getByTestId('ResetBtcServer')));
  expect(screen.getByTestId('BtcServerHost').props.value).toBe('private.server');
  expect(presentAlert).toHaveBeenCalledWith({
    title: 'BTC default not restored',
    message: expect.any(String),
  });
});

test('an invalid port is rejected before asking the backend to connect', async () => {
  const screen = render(<BtcElectrumSettings />);
  await act(async () => {});
  fireEvent.changeText(screen.getByTestId('BtcServerPort'), '1e3');
  await act(async () => fireEvent.press(screen.getByTestId('SaveBtcServer')));
  expect(Btc.setPreferredServer).not.toHaveBeenCalled();
  expect(presentAlert).toHaveBeenCalledWith({
    title: 'BTC server not saved',
    message: expect.stringContaining('port'),
  });
});

test('a pending save disables edits and prevents duplicate probes', async () => {
  let finish!: () => void;
  (Btc.setPreferredServer as jest.Mock).mockImplementationOnce(
    () =>
      new Promise<void>(resolve => {
        finish = resolve;
      }),
  );
  const screen = render(<BtcElectrumSettings />);
  await act(async () => {});
  await act(async () => {
    fireEvent.press(screen.getByTestId('SaveBtcServer'));
  });
  expect(screen.getByTestId('BtcServerHost').props.editable).toBe(false);
  fireEvent.press(screen.getByTestId('SaveBtcServer'));
  expect(Btc.setPreferredServer).toHaveBeenCalledTimes(1);
  await act(async () => finish());
  expect(screen.getByTestId('BtcServerHost').props.editable).toBe(true);
});
