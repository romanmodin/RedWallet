import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import DefaultPreference from 'react-native-default-preference';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import presentAlert from '../../components/Alert';

const mockNavigation = { setOptions: jest.fn(), setParams: jest.fn() };
jest.mock('../../hooks/useExtendedNavigation', () => ({ useExtendedNavigation: () => mockNavigation }));
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: {} }) }));
jest.mock('../../hooks/context/useSettings', () => ({
  useSettings: () => ({ isElectrumDisabled: false, setIsElectrumDisabled: jest.fn() }),
}));
jest.mock('../../components/themes', () => ({ useTheme: () => ({ colors: {} }) }));
jest.mock('../../blue_modules/hapticFeedback', () => ({
  __esModule: true,
  default: jest.fn(),
  HapticFeedbackTypes: {},
  triggerSelectionHapticFeedback: jest.fn(),
}));
jest.mock('../../components/Alert', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('../../class/deeplink-schema-match', () => ({}));
jest.mock('../../components/ChainReferenceSettings', () => () => null);
jest.mock('../../components/HeaderMenuButton', () => () => null);
jest.mock('../../components/DismissKeyboardInputAccessory', () => ({ DismissKeyboardInputAccessory: () => null }));
jest.mock('../../components/DoneAndDismissKeyboardInputAccessory', () => ({ DoneAndDismissKeyboardInputAccessory: () => null }));
jest.mock('../../components/AddressInput', () => {
  const { TextInput } = require('react-native');
  return ({ address, ...props }: any) => <TextInput {...props} value={address} />;
});
jest.mock('../../components/Button', () => {
  const { Pressable, Text } = require('react-native');
  return ({ title, ...props }: any) => (
    <Pressable {...props}>
      <Text>{title}</Text>
    </Pressable>
  );
});
jest.mock('../../components/SettingsSection', () => {
  const { View, Text, Pressable } = require('react-native');
  return {
    SettingsSection: View,
    SettingsScrollView: View,
    SettingsFootnote: Text,
    SettingsListItem: ({ title, subtitle, onPress, disabled }: any) => (
      <Pressable onPress={onPress} disabled={disabled}>
        <Text>{title}</Text>
        <Text>{subtitle}</Text>
      </Pressable>
    ),
  };
});
jest.mock('../../blue_modules/BlueElectrum', () => ({
  suggestedServers: require('../../class/xbt/electrum-presets').XBT_ELECTRUM_PRESETS,
  hardcodedPeers: [],
  ELECTRUM_HOST: 'electrum_host',
  ELECTRUM_TCP_PORT: 'electrum_tcp_port',
  ELECTRUM_SSL_PORT: 'electrum_ssl_port',
  ELECTRUM_TLS_CA: 'electrum_tls_ca',
  ELECTRUM_SERVER_HISTORY: 'electrum_server_history',
  getBackupServers: jest.fn(async () => []),
  getPreferredServer: jest.fn(),
  getConfig: jest.fn(async () => ({ connected: 0 })),
  testConnectionDetailed: jest.fn(),
  forceDisconnect: jest.fn(),
}));

const ElectrumSettings = require('../../screen/settings/ElectrumSettings').default;
const pem = '-----BEGIN CERTIFICATE-----\nY2VydA==\n-----END CERTIFICATE-----';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  (DefaultPreference.get as jest.Mock).mockResolvedValue(null);
  (BlueElectrum.getPreferredServer as jest.Mock).mockResolvedValue({ host: 'my.private.server', ssl: 50002, tlsCa: pem });
  (BlueElectrum.testConnectionDetailed as jest.Mock).mockResolvedValue({ ok: false, reason: 'certificate' });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('opening settings preserves the custom server; selecting a preset only fills the form with SSL enabled', async () => {
  const screen = render(<ElectrumSettings />);
  await act(async () => {});
  expect(screen.getByTestId('HostInput').props.value).toBe('my.private.server');
  expect(screen.getByTestId('TlsCaInput').props.value).toBe(pem);
  fireEvent.press(screen.getByText('Use Kilombino Electrum'));
  expect(screen.getByTestId('HostInput').props.value).toBe('fulcrum.kilombino.com');
  expect(screen.getByTestId('PortInput').props.value).toBe('17717');
  expect(screen.getByTestId('SSLPortInput').props.value).toBe(true);
  expect(screen.getByTestId('TlsCaInput').props.value).toBe('');
  expect(BlueElectrum.testConnectionDetailed).not.toHaveBeenCalled();
  expect(BlueElectrum.forceDisconnect).not.toHaveBeenCalled();
  expect(DefaultPreference.set).not.toHaveBeenCalled();
  expect(DefaultPreference.clear).not.toHaveBeenCalled();
});

test.each(['certificate', 'checkpoint', 'timeout', 'connection'])(
  'a failed %s check leaves all saved connection settings intact',
  async reason => {
    (BlueElectrum.testConnectionDetailed as jest.Mock).mockResolvedValue({ ok: false, reason });
    const screen = render(<ElectrumSettings />);
    await act(async () => {});
    fireEvent.press(screen.getByText('Use Kilombino Electrum'));
    await act(async () => fireEvent.press(screen.getByTestId('Save')));
    expect(BlueElectrum.testConnectionDetailed).toHaveBeenCalledWith('fulcrum.kilombino.com', 0, 17717, '');
    expect(screen.getByTestId('SSLPortInput').props.value).toBe(true);
    expect(presentAlert).toHaveBeenCalledWith({ message: expect.stringContaining('Your saved server has not been changed.') });
    expect(BlueElectrum.forceDisconnect).not.toHaveBeenCalled();
    expect(DefaultPreference.set).not.toHaveBeenCalled();
    expect(DefaultPreference.clear).not.toHaveBeenCalled();
  },
);

test('an existing TCP server is not silently migrated to the public preset or TLS', async () => {
  (BlueElectrum.getPreferredServer as jest.Mock).mockResolvedValue({ host: 'custom.onion', tcp: 50001 });
  const screen = render(<ElectrumSettings />);
  await act(async () => {});
  expect(screen.getByTestId('HostInput').props.value).toBe('custom.onion');
  expect(screen.getByTestId('PortInput').props.value).toBe('50001');
  expect(screen.getByTestId('SSLPortInput').props.value).toBe(false);
  expect(BlueElectrum.testConnectionDetailed).not.toHaveBeenCalled();
  expect(DefaultPreference.set).not.toHaveBeenCalled();
  expect(DefaultPreference.clear).not.toHaveBeenCalled();
});

test('saving a verified preset persists its TLS endpoint and removes only the old endpoint certificate', async () => {
  (BlueElectrum.testConnectionDetailed as jest.Mock).mockResolvedValue({ ok: true });
  const screen = render(<ElectrumSettings />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Use Kilombino Electrum'));
  await act(async () => fireEvent.press(screen.getByTestId('Save')));
  expect(DefaultPreference.set).toHaveBeenCalledWith('electrum_host', 'fulcrum.kilombino.com');
  expect(DefaultPreference.set).toHaveBeenCalledWith('electrum_ssl_port', '17717');
  expect(DefaultPreference.set).toHaveBeenCalledWith('electrum_tcp_port', '');
  expect(DefaultPreference.clear).toHaveBeenCalledWith('electrum_tls_ca');
});

test('history retains an explicitly trusted certificate for the same host and port as the preset', async () => {
  (DefaultPreference.get as jest.Mock).mockResolvedValue(JSON.stringify([{ host: 'fulcrum.kilombino.com', ssl: 17717, tlsCa: pem }]));
  render(<ElectrumSettings />);
  await act(async () => {});
  const options = mockNavigation.setOptions.mock.calls.at(-1)![0];
  const menu = options.headerRight();
  const history = menu.props.actions.find((action: any) => action.id === 'server_history');
  expect(history.subactions).toHaveLength(1);
  expect(JSON.parse(history.subactions[0].id.replace('set_preferred_', '')).tlsCa).toBe(pem);
});
