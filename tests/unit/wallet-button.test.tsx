import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { render } from '@testing-library/react-native';

import WalletButton from '../../components/WalletButton';
import { BlueDefaultTheme } from '../../components/themes';

test.each([false, true])('shows SHA-256 as the wallet type with selection set to %s', active => {
  const screen = render(
    <NavigationContainer theme={BlueDefaultTheme}>
      <WalletButton buttonType="BTC" active={active} onPress={jest.fn()} size={{ width: 320, height: undefined }} />
    </NavigationContainer>,
  );
  expect(screen.getByText('SHA-256')).toBeTruthy();
  expect(screen.getByText('Mainnet · connects only when selected')).toBeTruthy();
});
