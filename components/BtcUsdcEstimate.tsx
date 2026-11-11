import React from 'react';
import { StyleProp, Text, TextStyle } from 'react-native';
import { formatBtcUsdcEstimate } from '../blue_modules/btc-usdc-price';
import { useSettings } from '../hooks/context/useSettings';
import { useXbtPriceClock } from '../hooks/useXbtPriceClock';

interface Props {
  satoshis: number;
  inline?: boolean;
  style?: StyleProp<TextStyle>;
  testID?: string;
}
/** The same SHA-256 USDC quote is used for totals and cards, never the XBT quote. */
export default function BtcUsdcEstimate({ satoshis, inline = false, style, testID = 'BtcUsdcEstimate' }: Props) {
  const { btcUsdcPriceQuote: quote } = useSettings();
  const now = useXbtPriceClock(quote);
  if (!quote) return null;
  let estimate: string;
  try {
    estimate = formatBtcUsdcEstimate(satoshis, quote);
  } catch {
    return null;
  }
  const stale = now - quote.updatedAt >= 15 * 60 * 1000;
  const text = `≈ ${estimate}${stale ? ' · stale quote' : ''}`;
  return (
    <Text
      testID={testID}
      style={style}
      numberOfLines={inline ? undefined : 1}
      adjustsFontSizeToFit={!inline}
      minimumFontScale={0.75}
      accessibilityLabel={`SHA-256 approximate value ${estimate}. NeoxEX last trade ${new Date(quote.updatedAt).toLocaleString()}${stale ? '. Stale quote.' : ''}`}
    >
      {inline ? ` (${text})` : text}
    </Text>
  );
}
