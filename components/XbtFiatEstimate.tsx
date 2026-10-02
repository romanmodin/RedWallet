import { useXbtPriceClock } from '../hooks/useXbtPriceClock';
import React from 'react';
import { StyleProp, StyleSheet, Text, TextStyle, View } from 'react-native';
import { formatXbtQuoteEstimate } from '../blue_modules/xbt-price';
import { useSettings } from '../hooks/context/useSettings';
import { useTheme } from './themes';

interface Props {
  satoshis: number;
  style?: StyleProp<TextStyle>;
}

/** A labeled display estimate; it does not change wallet amounts or spending units. */
const XbtFiatEstimate = ({ satoshis, style }: Props) => {
  const { xbtPriceQuote } = useSettings();
  const { colors } = useTheme();
  const now = useXbtPriceClock(xbtPriceQuote);
  if (!xbtPriceQuote || !Number.isSafeInteger(satoshis)) return null;
  let estimate: string;
  try {
    estimate = formatXbtQuoteEstimate(satoshis, xbtPriceQuote);
  } catch {
    // A clock change or unusable saved quote must not interrupt the wallet balance.
    return null;
  }
  const quoteTime = new Date(xbtPriceQuote.updatedAt).toLocaleString();
  const stale = xbtPriceQuote.source === 'neoxex' && now - xbtPriceQuote.updatedAt >= 15 * 60 * 1000;
  const sourceLabel =
    xbtPriceQuote.source === 'manual'
      ? `Manual · updated ${quoteTime}`
      : `NeoxEX · last trade ${quoteTime}${stale ? ' · stale quote' : ''}`;
  return (
    <View style={styles.container} testID="XbtPriceEstimate">
      <Text style={[styles.amount, { color: colors.alternativeTextColor }, style]}>{`≈ ${estimate}`}</Text>
      <Text style={[styles.source, { color: colors.alternativeTextColor }, style]}>{sourceLabel}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginTop: 5 },
  amount: { fontSize: 14 },
  source: { fontSize: 11, marginTop: 2 },
});

export default XbtFiatEstimate;
