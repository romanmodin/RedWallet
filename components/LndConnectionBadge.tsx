import React, { useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { LndWallet } from '../class/wallets/lnd-wallet';

export default function LndConnectionBadge({ wallet }: { wallet: LndWallet }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick(value => value + 1), 5000);
    const subscription = AppState.addEventListener('change', () => {
      wallet.observedAt = 0;
      tick(value => value + 1);
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [wallet]);
  const state = wallet.connection();
  const label = state === 'connected' ? 'Connected' : state === 'checking' ? 'Syncing or waiting for peers' : 'Connection not verified';
  return (
    <View style={styles.badge} accessible accessibilityLabel={'LND · ' + label}>
      <View
        testID="LndConnectionLED"
        style={[styles.led, state === 'connected' ? styles.connected : state === 'checking' ? styles.checking : styles.disconnected]}
      />
      <Text style={styles.text}>⚡ LND</Text>
    </View>
  );
}
const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#741B2A',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  connected: { backgroundColor: '#47DA9B' },
  checking: { backgroundColor: '#FFD075' },
  disconnected: { backgroundColor: '#D0C4C7' },
  led: { width: 8, height: 8, borderRadius: 4 },
  text: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
});
