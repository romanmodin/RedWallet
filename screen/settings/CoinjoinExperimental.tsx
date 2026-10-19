import React, { useState } from 'react';
import { StyleSheet, Text, View, Pressable } from 'react-native';
import { SettingsScrollView, SettingsFootnote } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';
import Button from '../../components/Button';
import { change, feeShare } from '../../class/xbt/kilojoin/transaction';

/** Offline preview. Deliberately has no wallet, relay, signing or broadcast dependencies. */
const CoinjoinExperimental: React.FC = () => {
  const { colors } = useTheme();
  const [selected, setSelected] = useState(50000);
  const [reviewing, setReviewing] = useState(false);
  const amount = 10000;
  const rate = 2;
  const fee = feeShare(rate);
  const remainder = change(selected, amount, rate)!;
  const labelStyle = [styles.label, { color: colors.foregroundColor }];
  const cardStyle = [styles.card, { backgroundColor: colors.inputBackgroundColor }];
  const row = (label: string, value: string) => (
    <View style={styles.row}>
      <Text style={[styles.key, { color: colors.foregroundColor }]}>{label}</Text>
      <Text style={labelStyle}>{value}</Text>
    </View>
  );
  return (
    <SettingsScrollView testID="CoinjoinExperimentalScreen">
      <View style={styles.content}>
        <Text style={styles.badge}>Experimental</Text>
        <SettingsFootnote testID="CoinjoinOfflineNotice">
          Offline preview · Sample coins only. Live joining is not enabled.
        </SettingsFootnote>
        <Text style={[styles.heading, { color: colors.foregroundColor }]}>{reviewing ? 'Review sample round' : 'Join a pool'}</Text>
        <SettingsFootnote>Combine transactions with other participants. You approve the transaction before signing.</SettingsFootnote>
        <View style={cardStyle}>
          <Text style={labelStyle}>XBT pool · Sample</Text>
          <Text style={[styles.amount, { color: colors.foregroundColor }]}>10,000 sats</Text>
          <SettingsFootnote>Equal output per participant</SettingsFootnote>
          {row('Participants', '2 of 5')}
          {row('Fee rate', '2 sats/vB')}
          {row('Address type', 'Native SegWit')}
        </View>
        <View style={cardStyle}>
          <Text style={labelStyle}>Your sample coins</Text>
          {row('Selected', `${selected.toLocaleString('en-US')} sats`)}
          {row('Estimated fee', `${fee} sats`)}
          {row('Change', `${remainder.toLocaleString('en-US')} sats`)}
          {!reviewing && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose sample coin"
              testID="CoinjoinChooseSample"
              onPress={() => setSelected(value => (value === 50000 ? 60000 : 50000))}
            >
              <Text style={styles.link}>Choose sample coin ›</Text>
            </Pressable>
          )}
        </View>
        {reviewing ? (
          <>
            <SettingsFootnote testID="CoinjoinReviewNotice">
              This is a demonstration. No real coins are reserved, signed, or sent.
            </SettingsFootnote>
            <Button title="Live signing unavailable" onPress={() => undefined} disabled testID="CoinjoinSignDisabled" />
            <Pressable accessibilityRole="button" accessibilityLabel="Back to sample coins" onPress={() => setReviewing(false)}>
              <Text style={styles.link}>Back to sample coins</Text>
            </Pressable>
          </>
        ) : (
          <Button title="Review sample round" testID="CoinjoinReviewSample" onPress={() => setReviewing(true)} />
        )}
        <SettingsFootnote style={styles.credit}>Powered by Kilojoin · by Kilombino</SettingsFootnote>
      </View>
    </SettingsScrollView>
  );
};
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  badge: {
    color: '#D9A53A',
    backgroundColor: '#392B12',
    alignSelf: 'flex-start',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontWeight: '600',
  },
  heading: { fontSize: 30, fontWeight: '700' },
  card: { borderRadius: 18, padding: 20, gap: 14 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' },
  label: { fontSize: 17, fontWeight: '600' },
  key: { fontSize: 16, opacity: 0.75 },
  amount: { fontSize: 34, fontWeight: '700' },
  link: { color: '#D3263E', paddingVertical: 12, fontSize: 17, fontWeight: '600' },
  credit: { textAlign: 'center', marginTop: 12 },
});
export default CoinjoinExperimental;
