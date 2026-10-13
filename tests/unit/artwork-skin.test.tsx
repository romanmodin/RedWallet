import React from 'react';
import { render, renderHook, fireEvent, act } from '@testing-library/react-native';
import DefaultPreference from 'react-native-default-preference';
import { isArtworkDoubleTap, loadArtworkSkin, toggleArtworkSkin, useArtworkSkin, ARTWORK_SKIN_KEY } from '../../blue_modules/artwork-skin';
import ArtworkSkinToggle from '../../components/ArtworkSkinToggle';
import ArtworkSkinSurface from '../../components/ArtworkSkinSurface';
import { Text } from 'react-native';
jest.mock('react-native-default-preference', () => ({ setName: jest.fn(), get: jest.fn(), set: jest.fn() }));
jest.mock('../../blue_modules/currency', () => ({ GROUP_IO_BLUEWALLET: 'group' }));

jest.mock('../../components/themes', () => ({ useTheme: () => ({ colors: { alternativeTextColor: '#999' } }) }));

beforeEach(() => {
  jest.clearAllMocks();
});

it('requires a genuine pair of taps within the gesture window', () => {
  expect(isArtworkDoubleTap(undefined, 100)).toBe(false);
  expect(isArtworkDoubleTap(100, 550)).toBe(true);
  expect(isArtworkDoubleTap(100, 551)).toBe(false);
  expect(isArtworkDoubleTap(100, 99)).toBe(false);
});

it('restores an explicitly saved enabled choice on a fresh app load', async () => {
  let module: typeof import('../../blue_modules/artwork-skin');
  jest.isolateModules(() => {
    const preferences = require('react-native-default-preference');
    preferences.get.mockResolvedValue('enabled');
    module = require('../../blue_modules/artwork-skin');
  });
  await module!.loadArtworkSkin();
  expect(module!.getArtworkSkin()).toBe(true);
});

it('does not enable the skin for invalid saved values', async () => {
  let module: typeof import('../../blue_modules/artwork-skin');
  jest.isolateModules(() => {
    const preferences = require('react-native-default-preference');
    preferences.get.mockResolvedValue('true');
    module = require('../../blue_modules/artwork-skin');
  });
  await module!.loadArtworkSkin();
  expect(module!.getArtworkSkin()).toBe(false);
});

it('defaults to the normal appearance and changes only the cosmetic preference on toggle', async () => {
  const hook = renderHook(() => useArtworkSkin());
  await act(async () => {
    await loadArtworkSkin();
  });
  expect(hook.result.current).toBe(false);
  await act(async () => {
    await toggleArtworkSkin();
  });
  expect(hook.result.current).toBe(true);
  expect(DefaultPreference.set).toHaveBeenLastCalledWith(ARTWORK_SKIN_KEY, 'enabled');
  await act(async () => {
    await toggleArtworkSkin();
  });
  expect(hook.result.current).toBe(false);
  expect(DefaultPreference.set).toHaveBeenLastCalledWith(ARTWORK_SKIN_KEY, 'disabled');
  hook.unmount();
});

it('does not enable artwork when saving the preference fails', async () => {
  (DefaultPreference.set as jest.Mock).mockRejectedValueOnce(new Error('unavailable'));
  await expect(toggleArtworkSkin()).rejects.toThrow('unavailable');
  const hook = renderHook(() => useArtworkSkin());
  expect(hook.result.current).toBe(false);
  hook.unmount();
});

it('retains wallet content and renders no artwork when disabled', () => {
  const screen = render(
    <ArtworkSkinSurface active={false}>
      <Text>Receive address</Text>
    </ArtworkSkinSurface>,
  );
  expect(screen.getByText('Receive address')).toBeTruthy();
  expect(screen.queryByTestId('ArtworkSkinBackground')).toBeNull();
  screen.rerender(
    <ArtworkSkinSurface active>
      <Text>Receive address</Text>
    </ArtworkSkinSurface>,
  );
  expect(screen.getByText('Receive address')).toBeTruthy();
  expect(screen.getByTestId('ArtworkSkinBackground', { includeHiddenElements: true })).toBeTruthy();
});

it('single-tapping the logo never enables the skin', async () => {
  const screen = render(<ArtworkSkinToggle />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
  expect(DefaultPreference.set).not.toHaveBeenCalled();
  screen.unmount();
});

it('a double-tap toggles on and a second double-tap restores default', async () => {
  let now = 1000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const screen = render(<ArtworkSkinToggle />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
  now += 200;
  await act(async () => {
    fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
  });
  expect(DefaultPreference.set).toHaveBeenLastCalledWith(ARTWORK_SKIN_KEY, 'enabled');
  now += 1000;
  fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
  now += 200;
  await act(async () => {
    fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
  });
  expect(DefaultPreference.set).toHaveBeenLastCalledWith(ARTWORK_SKIN_KEY, 'disabled');
  screen.unmount();
  jest.restoreAllMocks();
});
