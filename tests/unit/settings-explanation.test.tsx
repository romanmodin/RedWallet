import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render } from '@testing-library/react-native';
import SettingsExplanation from '../../components/SettingsExplanation';

jest.mock('../../components/themes', () => {
  const real = jest.requireActual('../../components/themes');
  return { ...real, useTheme: () => real.BlueDarkTheme };
});
const stored = new Map<string, string>();
beforeEach(() => {
  stored.clear();
  jest.mocked(AsyncStorage.getItem).mockImplementation(async key => stored.get(key) ?? null);
  jest.mocked(AsyncStorage.setItem).mockImplementation(async (key, value) => {
    stored.set(key, value);
  });
});
const help = (
  <SettingsExplanation id="test.selection" title="How to select a channel">
    Tap a channel to choose where actions apply.
  </SettingsExplanation>
);

test('first-use explanation opens, body tap collapses, and the choice survives reopening the screen', async () => {
  const first = render(help);
  await act(async () => {});
  expect(first.getByText('Tap a channel to choose where actions apply.')).toBeTruthy();
  await act(async () => fireEvent.press(first.getByText('Tap a channel to choose where actions apply.')));
  expect(first.queryByText('Tap a channel to choose where actions apply.')).toBeNull();
  first.unmount();
  const reopened = render(help);
  await act(async () => {});
  expect(reopened.queryByText('Tap a channel to choose where actions apply.')).toBeNull();
  expect(reopened.getByTestId('SettingsExplanation-test.selection').props.accessibilityState).toEqual({ expanded: false });
  await act(async () => fireEvent.press(reopened.getByText('How to select a channel')));
  expect(reopened.getByText('Tap a channel to choose where actions apply.')).toBeTruthy();
  reopened.unmount();
});
test('collapsing one explanation leaves other first-use help open', async () => {
  const first = render(help);
  await act(async () => fireEvent.press(first.getByText('How to select a channel')));
  first.unmount();
  const second = render(
    <SettingsExplanation id="test.tor" title="About Tor">
      Connection details.
    </SettingsExplanation>,
  );
  await act(async () => {});
  expect(second.getByText('Connection details.')).toBeTruthy();
  second.unmount();
});
test('a late saved-preference response cannot undo the user’s newer tap', async () => {
  let resolveRead!: (value: string | null) => void;
  jest.mocked(AsyncStorage.getItem).mockImplementationOnce(() => new Promise(resolve => (resolveRead = resolve)));
  const screen = render(help);
  await act(async () => fireEvent.press(screen.getByText('How to select a channel')));
  await act(async () => resolveRead(null));
  expect(screen.queryByText('Tap a channel to choose where actions apply.')).toBeNull();
  screen.unmount();
});
test('unavailable preference storage still leaves help readable and tappable', async () => {
  jest.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('Storage unavailable'));
  jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('Storage unavailable'));
  const screen = render(help);
  await act(async () => {});
  expect(screen.getByText('Tap a channel to choose where actions apply.')).toBeTruthy();
  await act(async () => fireEvent.press(screen.getByText('How to select a channel')));
  expect(screen.queryByText('Tap a channel to choose where actions apply.')).toBeNull();
  screen.unmount();
});
