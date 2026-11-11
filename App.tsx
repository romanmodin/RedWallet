import { BlueApp } from './class/blue-app';
import { selectWalletNetwork } from './blue_modules/wallet-network';
import { setForeground } from './blue_modules/BtcElectrum';
import { AppState, useColorScheme } from 'react-native';
import React, { useEffect } from 'react';
import { NavigationContainer, NavigationContainerRef, ParamListBase } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SizeClassProvider } from './components/Context/SizeClassProvider';
import { SettingsProvider } from './components/Context/SettingsProvider';
import { BlueDarkTheme, BlueDefaultTheme } from './components/themes';
import MasterView from './navigation/MasterView';
import { navigationRef } from './NavigationService';
import { useLogger } from '@react-navigation/devtools';
import { StorageProvider } from './components/Context/StorageProvider';

const App = () => {
  const colorScheme = useColorScheme();
  useEffect(() => {
    setForeground(AppState.currentState === 'active');
    const subscription = AppState.addEventListener('change', state => setForeground(state === 'active'));
    return () => {
      subscription.remove();
      selectWalletNetwork();
    };
  }, []);
  const selectNetwork = () => {
    const route = navigationRef.getCurrentRoute();
    if (route?.name === 'WalletsList') return;
    const id = (route?.params as { walletID?: string } | undefined)?.walletID;
    selectWalletNetwork(id ? BlueApp.getInstance().wallets.find(wallet => wallet.getID() === id) : undefined);
  };

  useLogger(navigationRef as unknown as React.RefObject<NavigationContainerRef<ParamListBase>>);

  return (
    <SizeClassProvider>
      <NavigationContainer
        onStateChange={selectNetwork}
        onReady={selectNetwork}
        ref={navigationRef}
        theme={colorScheme === 'dark' ? BlueDarkTheme : BlueDefaultTheme}
      >
        <SafeAreaProvider>
          <StorageProvider>
            <SettingsProvider>
              <MasterView />
            </SettingsProvider>
          </StorageProvider>
        </SafeAreaProvider>
      </NavigationContainer>
    </SizeClassProvider>
  );
};

export default App;
