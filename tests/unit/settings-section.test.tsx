import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

import english from '../../loc/en.json';
import { getSettingsHeaderOptions } from '../../navigation/helpers/getSettingsHeaderOptions';
import { SettingsFootnote, SettingsListItem, SettingsSection } from '../../components/SettingsSection';

jest.mock('../../components/themes', () => ({
  useTheme: () => ({
    dark: false,
    colors: {
      foregroundColor: '#000000',
      alternativeTextColor: '#9aa0aa',
      cardSectionHeaderBackground: '#f2f2f7',
      cardSectionBackground: '#ffffff',
      background: '#ffffff',
    },
  }),
}));

describe('SettingsSection', () => {
  it('renders title and children', () => {
    const { getByText } = render(
      <SettingsSection title="Advanced">
        <Text>child row</Text>
      </SettingsSection>,
    );
    expect(getByText('Advanced')).toBeTruthy();
    expect(getByText('child row')).toBeTruthy();
  });

  it('renders no header when title and headerRight are absent', () => {
    const { queryByRole, getByText } = render(
      <SettingsSection>
        <Text>body only</Text>
      </SettingsSection>,
    );
    expect(queryByRole('button')).toBeNull();
    expect(getByText('body only')).toBeTruthy();
  });

  it('renders headerRight content', () => {
    const { getByTestId } = render(
      <SettingsSection title="Details" headerRight={<View testID="header-right" />}>
        <Text>row</Text>
      </SettingsSection>,
    );
    expect(getByTestId('header-right')).toBeTruthy();
  });

  it('calls onHeaderPress when the header is pressed', () => {
    const onHeaderPress = jest.fn();
    const { getByRole } = render(
      <SettingsSection title="Advanced" onHeaderPress={onHeaderPress}>
        <Text>row</Text>
      </SettingsSection>,
    );
    fireEvent.press(getByRole('button'));
    expect(onHeaderPress).toHaveBeenCalledTimes(1);
  });

  it('does not wrap the header in a button without onHeaderPress', () => {
    const { queryByRole } = render(
      <SettingsSection title="Plain">
        <Text>row</Text>
      </SettingsSection>,
    );
    expect(queryByRole('button')).toBeNull();
  });
});

describe('SettingsListItem', () => {
  it('renders title and forwards presses', () => {
    const onPress = jest.fn();
    const { getByText } = render(<SettingsListItem title="Currency" iconName="currency" onPress={onPress} testID="CurrencyItem" />);
    fireEvent.press(getByText('Currency'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SettingsFootnote', () => {
  it('renders its text', () => {
    const { getByText } = render(<SettingsFootnote>explanation</SettingsFootnote>);
    expect(getByText('explanation')).toBeTruthy();
  });
});

describe('Settings typography', () => {
  it('preserves the authored heading, switch hint, and mixed-case values', () => {
    const title = english.settings.privacy_temporary_screenshots;
    const description = english.settings.privacy_temporary_screenshots_instructions;
    const { getByRole, getByText } = render(
      <SettingsSection title={english.hardware_check.title}>
        <SettingsListItem title={title} subtitle={description} switch={{ value: false }} />
        <SettingsListItem title="myNode.Example" />
      </SettingsSection>,
    );
    expect(getByRole('switch', { name: 'Allow Screen Capture' }).props.accessibilityHint).toBe(description);
    for (const label of ['Hardware Signing Check', 'Allow Screen Capture', 'myNode.Example']) {
      const style = StyleSheet.flatten(getByText(label).props.style);
      expect(style.textTransform).toBeUndefined();
      expect(style.transform).toBeUndefined();
    }
    const theme = jest.requireActual('../../components/themes').BlueDarkTheme;
    expect(getSettingsHeaderOptions('RedWallet On iOS', theme).title).toBe('RedWallet On iOS');
  });

  it('gives descriptions more wrapping room while preserving text height and their column edges', () => {
    const description = english.settings.privacy_clipboard_explanation;
    const note = 'Your iOS settings apply when you reopen RedWallet.';
    const { getByText } = render(
      <SettingsSection>
        <SettingsListItem title="Read Clipboard" subtitle={description} switch={{ value: true }} />
        <SettingsFootnote>{note}</SettingsFootnote>
      </SettingsSection>,
    );
    for (const body of [description, note]) {
      const line = getByText(body);
      const style = StyleSheet.flatten(line.props.style);
      expect(style.fontSize).toBe(13);
      expect(line.props.allowFontScaling).not.toBe(false);
      expect(style.textTransform).toBeUndefined();
      expect(style.alignSelf).toBe('center');
      expect(style.transform).toEqual([{ scaleX: 0.94 }]);
      expect(parseFloat(style.width) * style.transform[0].scaleX).toBeCloseTo(100);
    }
    expect(getByText(description).props.numberOfLines).toBe(0);
  });
});
