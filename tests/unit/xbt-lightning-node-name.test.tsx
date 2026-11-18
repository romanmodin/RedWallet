import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { NativeModules } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }) }));
jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDefaultTheme };
});
type State = { saved: string; active: string; restartRequired: boolean };
const initial: State = { saved: 'RedWallet', active: 'RedWallet', restartRequired: false };
const bridge = { nodeName: jest.fn<Promise<State>, [string, string]>() };
NativeModules.XBTLightningBridge = bridge;
const NodeName = require('../../components/XBTLightningNodeName').default;
beforeEach(() => {
  jest.clearAllMocks();
  bridge.nodeName.mockResolvedValue(initial);
});

test('saves a name without claiming it changed the active node and survives reopening', async () => {
  const screen = render(<NodeName status="Running" busy={false} />);
  await act(async () => {});
  expect(screen.getByLabelText('Lightning node name').props.value).toBe('RedWallet');
  fireEvent.changeText(screen.getByLabelText('Lightning node name'), 'XCOM79 Mobile');
  bridge.nodeName.mockResolvedValue({ ...initial, saved: 'XCOM79 Mobile', restartRequired: true });
  await act(async () => fireEvent.press(screen.getByText('Save node name')));
  expect(bridge.nodeName).toHaveBeenLastCalledWith('save', 'XCOM79 Mobile');
  expect(screen.getByText('Current: RedWallet')).toBeTruthy();
  expect(screen.getByText(/After payments finish/)).toBeTruthy();
  screen.unmount();
  const reopened = render(<NodeName status="Running" busy={false} />);
  await act(async () => {});
  expect(reopened.getByLabelText('Lightning node name').props.value).toBe('XCOM79 Mobile');
  reopened.unmount();
});

test('failed saves keep the old name and the editable draft', async () => {
  const screen = render(<NodeName status="Running" busy={false} />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Lightning node name'), 'XCOM79 Mobile');
  bridge.nodeName.mockRejectedValue(new Error('Could not write preference.'));
  await act(async () => fireEvent.press(screen.getByText('Save node name')));
  expect(screen.getByText('Could not write preference.')).toBeTruthy();
  expect(screen.getByText('Saved name: RedWallet')).toBeTruthy();
  expect(screen.getByLabelText('Lightning node name').props.value).toBe('XCOM79 Mobile');
  screen.unmount();
});

test('node status refresh does not erase an unsaved edit', async () => {
  const screen = render(<NodeName status="Stopped" busy={false} />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Lightning node name'), 'My draft');
  screen.rerender(<NodeName status="Running" busy={false} />);
  await act(async () => {});
  expect(screen.getByLabelText('Lightning node name').props.value).toBe('My draft');
  screen.unmount();
});

test('a stale read cannot overwrite a newer saved value', async () => {
  const screen = render(<NodeName status="Syncing" busy={false} />);
  await act(async () => {});
  let finishRead!: (state: State) => void;
  bridge.nodeName.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finishRead = resolve;
      }),
  );
  screen.rerender(<NodeName status="Running" busy={false} />);
  fireEvent.changeText(screen.getByLabelText('Lightning node name'), 'XCOM79 Mobile');
  bridge.nodeName.mockResolvedValue({ ...initial, saved: 'XCOM79 Mobile', restartRequired: true });
  await act(async () => fireEvent.press(screen.getByText('Save node name')));
  await act(async () => finishRead(initial));
  expect(screen.getByLabelText('Lightning node name').props.value).toBe('XCOM79 Mobile');
  expect(screen.getByText(/After payments finish/)).toBeTruthy();
  screen.unmount();
});

test('a failed read can be retried or explicitly replaced, without an automatic reset', async () => {
  bridge.nodeName.mockRejectedValueOnce(new Error('Invalid saved JSON'));
  const screen = render(<NodeName status="Stopped" busy={false} />);
  await act(async () => {});
  expect(screen.getByText('Retry loading node name')).toBeTruthy();
  expect(bridge.nodeName.mock.calls.some(call => call[0] === 'save')).toBe(false);
  fireEvent.changeText(screen.getByLabelText('Lightning node name'), 'RedWallet');
  await act(async () => fireEvent.press(screen.getByText('Save node name')));
  expect(bridge.nodeName).toHaveBeenLastCalledWith('save', 'RedWallet');
  screen.unmount();
});

test('busy operations and repeated presses cannot submit duplicate saves', async () => {
  const screen = render(<NodeName status="Running" busy={false} />);
  await act(async () => {});
  fireEvent.changeText(screen.getByLabelText('Lightning node name'), 'XCOM79 Mobile');
  screen.rerender(<NodeName status="Running" busy />);
  fireEvent.press(screen.getByText('Save node name'));
  expect(bridge.nodeName.mock.calls.filter(call => call[0] === 'save')).toHaveLength(0);
  screen.rerender(<NodeName status="Running" busy={false} />);
  let finish!: (state: State) => void;
  bridge.nodeName.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  fireEvent.press(screen.getByText('Save node name'));
  fireEvent.press(screen.getByText('Saving node name…'));
  expect(bridge.nodeName.mock.calls.filter(call => call[0] === 'save')).toHaveLength(1);
  await act(async () => finish({ ...initial, saved: 'XCOM79 Mobile', restartRequired: true }));
  screen.unmount();
});
