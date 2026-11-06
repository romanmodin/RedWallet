import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert, NativeModules } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
const state = {
  selected: 'direct',
  active: 'direct',
  running: true,
  restartRequired: false,
  status: 'Direct connection',
  defaultTower: '02fixture@tower.onion:9911',
};
const tower = { key: '02fixture', addresses: ['tower.onion:9911'], eligible: true, sessions: '0', acknowledged: '0', pending: '0' };
const bridge = {
  network: jest.fn<Promise<typeof state>, [string, string]>(),
  watchtower: jest.fn<Promise<(typeof tower)[]>, [string, string]>(),
};
NativeModules.XBTLightningBridge = bridge;
const Network = require('../../components/XBTLightningNetwork').default;
const report = jest.fn();
const onTorChange = jest.fn();
const run = async (_title: string, action: () => Promise<void>) => action();
const props = { status: 'Running', busy: false, report, onTorChange, run };

beforeEach(() => {
  jest.clearAllMocks();
  bridge.network.mockResolvedValue(state);
  bridge.watchtower.mockResolvedValue([tower]);
});

test('shows registered versus acknowledged protection and does not enroll a default tower automatically', async () => {
  const screen = render(<Network {...props} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Tor and watchtower settings'));
  expect(screen.getByLabelText('Watchtower address').props.value).toBe(state.defaultTower);
  expect(screen.getByText(/No protection updates acknowledged yet/)).toBeTruthy();
  expect(bridge.watchtower).toHaveBeenCalledWith('list', '');
  expect(bridge.watchtower.mock.calls.some(call => call[0] === 'add')).toBe(false);
  screen.unmount();
});

test('saving Tor on an already running direct node requires restart and does not report Tor as active', async () => {
  const screen = render(<Network {...props} />);
  await act(async () => {});
  fireEvent.press(screen.getByText('Tor and watchtower settings'));
  bridge.network.mockResolvedValue({ ...state, selected: 'tor', restartRequired: true });
  await act(async () => fireEvent.press(screen.getByText('Use Tor for Lightning')));
  expect(bridge.network).toHaveBeenCalledWith('select', 'tor');
  expect(onTorChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByText(/Restart RedWallet to apply/)).toBeTruthy();
  screen.unmount();
});

test('adds a custom tower and only removes the selected identity after confirmation', async () => {
  const prompt = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const screen = render(<Network {...props} />);
  try {
    await act(async () => {});
    fireEvent.press(screen.getByText('Tor and watchtower settings'));
    fireEvent.changeText(screen.getByLabelText('Watchtower address'), '03custom@home.onion:9911');
    await act(async () => fireEvent.press(screen.getByText('Add watchtower')));
    expect(bridge.watchtower).toHaveBeenCalledWith('add', '03custom@home.onion:9911');
    fireEvent.press(screen.getByText('Remove watchtower'));
    expect(bridge.watchtower.mock.calls.some(call => call[0] === 'remove')).toBe(false);
    const buttons = prompt.mock.calls[0][2]!;
    await act(async () => buttons.find(button => button.text === 'Remove')!.onPress!());
    expect(bridge.watchtower).toHaveBeenCalledWith('remove', tower.key);
  } finally {
    screen.unmount();
    prompt.mockRestore();
  }
});
