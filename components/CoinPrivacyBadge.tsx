import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { CoinPrivacyStatus } from '../class/xbt/coin-privacy';
import loc from '../loc';

/** Text plus color: status remains understandable with color vision differences. */
export default function CoinPrivacyBadge({ status, frozen = false }: { status: CoinPrivacyStatus; frozen?: boolean }) {
  const label = {
    mixed: loc.cc.privacy_mixed,
    pending: loc.cc.privacy_pending,
    change: frozen ? loc.cc.privacy_change_frozen : loc.cc.privacy_change,
    unknown: loc.cc.privacy_unknown,
  }[status];
  const color = { mixed: styles.mixed, pending: styles.pending, change: styles.change, unknown: styles.unknown }[status];
  return (
    <View accessible accessibilityRole="text" accessibilityLabel={label} testID={`CoinPrivacy-${status}`} style={[styles.badge, color]}>
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { alignSelf: 'flex-start', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginTop: 4 },
  text: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', flexShrink: 1 },
  mixed: { backgroundColor: '#6B21A8' },
  pending: { backgroundColor: '#1557A5' },
  change: { backgroundColor: '#854D0E' },
  unknown: { backgroundColor: '#52525B' },
});
