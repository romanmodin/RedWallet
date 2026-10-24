import React from 'react';
import { render, renderHook, fireEvent, act } from '@testing-library/react-native';
import DefaultPreference from 'react-native-default-preference';
import { loadArtworkSkin, toggleArtworkSkin, useArtworkSkin, ARTWORK_SKIN_KEY } from '../../blue_modules/artwork-skin';
import ArtworkSkinToggle from '../../components/ArtworkSkinToggle';
import ArtworkSkinSurface from '../../components/ArtworkSkinSurface';
import { StyleSheet, Text } from 'react-native';
jest.mock('react-native-default-preference', () => ({
  setName: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
}));
jest.mock('../../blue_modules/currency', () => ({
  GROUP_IO_BLUEWALLET: 'group',
}));

jest.mock('../../components/themes', () => ({
  useTheme: () => ({ colors: { alternativeTextColor: '#999' } }),
}));

beforeEach(() => {
  jest.clearAllMocks();
});

it('restores an explicitly saved enabled choice on a fresh app load', async () => {
  let module: typeof import('../../blue_modules/artwork-skin');
  jest.isolateModules(() => {
    const preferences = require('react-native-default-preference');
    preferences.get.mockResolvedValue('enabled');
    module = require('../../blue_modules/artwork-skin');
  });
  await module!.loadArtworkSkin();
  expect(module!.getArtworkSkin()).toBe('helmet');
});

it('does not enable the skin for invalid saved values', async () => {
  let module: typeof import('../../blue_modules/artwork-skin');
  jest.isolateModules(() => {
    const preferences = require('react-native-default-preference');
    preferences.get.mockResolvedValue('true');
    module = require('../../blue_modules/artwork-skin');
  });
  await module!.loadArtworkSkin();
  expect(module!.getArtworkSkin()).toBe('off');
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
  expect(DefaultPreference.set).toHaveBeenLastCalledWith(ARTWORK_SKIN_KEY, 'helmet');
  await act(async () => {
    await toggleArtworkSkin();
  });
  expect(hook.result.current).toBe(true);
  expect(DefaultPreference.set).toHaveBeenLastCalledWith(ARTWORK_SKIN_KEY, 'armour');
  await act(async () => {
    await toggleArtworkSkin();
  });
  expect(hook.result.current).toBe(false);
  expect(DefaultPreference.set).toHaveBeenLastCalledWith(ARTWORK_SKIN_KEY, 'off');
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
  expect(
    screen.getByTestId('ArtworkSkinBackground', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
});

it('each logo tap cycles Helmet, Armour, Off and rapid taps are serialized', async () => {
  const screen = render(<ArtworkSkinToggle />);
  await act(async () => {});
  for (const name of ['Helmet', 'Armour', 'Off']) {
    await act(async () => {
      fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
    });
    expect(screen.getByLabelText(`Artwork skin: ${name}`)).toBeTruthy();
  }
  await act(async () => {
    fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
    fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
    fireEvent.press(screen.getByTestId('ArtworkSkinLogo'));
  });
  expect(screen.getByLabelText('Artwork skin: Off')).toBeTruthy();
  screen.unmount();
});

it('restores the second skin after app restart', async () => {
  let module: typeof import('../../blue_modules/artwork-skin');
  jest.isolateModules(() => {
    require('react-native-default-preference').get.mockResolvedValue('armour');
    module = require('../../blue_modules/artwork-skin');
  });
  await module!.loadArtworkSkin();
  expect(module!.getArtworkSkin()).toBe('armour');
});

it.each([
  [390, 740],
  [740, 390],
  [768, 1024],
])('fits the entire portrait armour at %s x %s', (width, height) => {
  const screen = render(
    <ArtworkSkinSurface active skin="armour">
      <Text>Wallet content</Text>
    </ArtworkSkinSurface>,
  );
  fireEvent(screen.getByTestId('ArtworkSkinSurface'), 'layout', { nativeEvent: { layout: { width, height } } });
  const image = screen.getByTestId('ArtworkSkinBackground', { includeHiddenElements: true });
  const style = StyleSheet.flatten(image.props.style);
  expect(image.props.source).toEqual(require('../../img/optional-skin/armour.jpeg'));
  expect(image.props.resizeMode).toBe('contain');
  expect(style.width).toBe(width);
  expect(style.height).toBe(Math.min(height, (width * 739) / 415));
});

it.each([
  [390, 740],
  [430, 850],
  [700, 390],
  [320, 900],
])('constrains artwork to its measured %s x %s surface without intrinsic image dimensions', (width, height) => {
  const screen = render(
    <ArtworkSkinSurface active>
      <Text>Wallet content</Text>
    </ArtworkSkinSurface>,
  );
  fireEvent(screen.getByTestId('ArtworkSkinSurface'), 'layout', {
    nativeEvent: { layout: { width, height } },
  });
  const image = screen.getByTestId('ArtworkSkinBackground', {
    includeHiddenElements: true,
  });
  const style = StyleSheet.flatten(image.props.style);
  expect(style.width).toBe(width);
  expect(style.height).toBe(Math.min(height, width * 1.15));
  expect(style.top).toBe(0);
  expect(style.left).toBe(0);
  // The central helmet fits in the crop instead of scaling to a full tall screen.
  const scale = Math.max(style.width / 1757, style.height / 969);
  expect(600 * scale).toBeLessThanOrEqual(width);
  expect(screen.getByText('Wallet content')).toBeTruthy();
  fireEvent(screen.getByTestId('ArtworkSkinSurface'), 'layout', {
    nativeEvent: { layout: { width: height, height: width } },
  });
  expect(
    StyleSheet.flatten(
      screen.getByTestId('ArtworkSkinBackground', {
        includeHiddenElements: true,
      }).props.style,
    ).width,
  ).toBe(height);
});
