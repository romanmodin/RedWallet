import React, { useSyncExternalStore } from 'react';
import { Text, StyleSheet } from 'react-native';
import { subscribe, getConnectionState } from '../blue_modules/BtcElectrum';
import ChainFreshnessIndicator from './ChainFreshnessIndicator';

export default function WalletNetworkIndicator(props: React.ComponentProps<typeof ChainFreshnessIndicator>) {
  const state = useSyncExternalStore(subscribe, getConnectionState, getConnectionState);
  if (state === 'inactive') return <ChainFreshnessIndicator {...props} />;
  return (
    <Text accessibilityRole="text" style={styles.status}>
      {state === 'connected' ? '● BTC CONNECTED' : '○ BTC SELECTED'}
    </Text>
  );
}
const styles = StyleSheet.create({ status: { color: '#2478D4', fontSize: 13, fontWeight: '600' } });
