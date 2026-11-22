import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { LndOverview } from '../class/wallets/lnd-wallet';
import { lndBalanceBreakdown } from '../blue_modules/lnd-balance-breakdown';
import { useTheme } from './themes';

export default function LndBalanceBreakdown({
  overview,
  hidden,
  stale,
  format,
}: {
  overview: LndOverview;
  hidden: boolean;
  stale: boolean;
  format: (value: number) => string;
}) {
  const { colors } = useTheme();
  let balances: ReturnType<typeof lndBalanceBreakdown>;
  try {
    balances = lndBalanceBreakdown(overview);
  } catch {
    return <Text style={{ color: colors.alternativeTextColor }}>Balance breakdown unavailable. Refresh the node.</Text>;
  }
  const rows: [string, number | undefined][] = [
    ['Available to send over Lightning · estimate', stale ? undefined : balances.lightningAvailable],
    ['Unavailable to send in channels · estimate', stale ? undefined : balances.channelUnavailable],
    ['On-chain available before fee', balances.onchainAvailable],
    ['Unconfirmed on-chain', balances.fundingPending],
    ['Opening channels', balances.channelPending],
    ['Resize awaiting lock', balances.splicePending],
    ['Locked funding outputs', balances.fundingLocked],
    ['Anchor reserve', balances.anchorReserve],
  ];
  const channelColor = { color: colors.channelBalanceColor };
  return (
    <View testID="LndBalanceBreakdown" style={styles.root}>
      <Text style={[styles.title, { color: colors.foregroundColor }]}>Balance Details{stale ? ' · Last Observed' : ''}</Text>
      <View style={styles.row}>
        <Text style={[styles.title, channelColor]}>Your balance in channels</Text>
        <Text style={[styles.title, channelColor]}>{hidden ? '••••' : format(balances.channelBalance)}</Text>
      </View>
      <Text style={{ color: colors.settingsTextColor }}>
        {stale
          ? 'Last reported by your node. Your channel funds count toward the wallet total. Reconnect to check what you can send.'
          : overview.activeChannels === '0'
            ? 'These funds are included in your total. With no active channels, they are unavailable to send over Lightning.'
            : 'These funds are included in your total. The available estimate shows how much you can send over Lightning.'}
      </Text>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.row}>
          <Text style={{ color: colors.settingsTextColor }}>{label}</Text>
          <Text style={{ color: label === 'On-chain available before fee' && !stale && !hidden && (value ?? 0) > 0 ? colors.successColor : colors.foregroundColor }}>
            {hidden ? '••••' : value === undefined ? 'Refresh node' : format(value)}
          </Text>
        </View>
      ))}
      <Text style={{ color: colors.alternativeTextColor }}>
        Available amounts exclude reserves. Lightning routing, channel limits and fees can reduce a payment’s maximum. Pending, locked and
        reserve rows describe different states and must not be added to the total again.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { padding: 16, gap: 8 },
  title: { fontWeight: '600' },
  row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 4 },
});
