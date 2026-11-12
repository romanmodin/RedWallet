import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BigNumber from 'bignumber.js';
import { AmountInput } from './AmountInput';
import BtcUsdcEstimate from './BtcUsdcEstimate';
import XbtFiatEstimate from './XbtFiatEstimate';
import { useSettings } from '../hooks/context/useSettings';
import { useXbtPriceClock } from '../hooks/useXbtPriceClock';
import { BitcoinUnit } from '../models/bitcoinUnits';
import { fetchNeoxexBtcPrice, fetchNeoxexPrice } from '../blue_modules/neoxex-price';
import { SendUsdcQuote, UsdcSendEntry, sendSatsToUsdc, toSendUsdcQuote, usdcToSendSats } from '../blue_modules/send-usdc';
import { useTheme } from './themes';

type Props = React.ComponentProps<typeof AmountInput> & {
  usdcEntry?: UsdcSendEntry;
  onSatsChange: (sats: string, coins?: string, entry?: UsdcSendEntry) => void;
  onQuoteRefreshChange: (refreshing: boolean) => void;
};

export default function SendAmountInput({ onSatsChange, onQuoteRefreshChange, usdcEntry, ...props }: Props) {
  const { btcUsdcPriceQuote, xbtPriceQuote } = useSettings();
  const { colors } = useTheme();
  const asset = props.assetTicker === 'BTC' ? 'BTC' : 'XBT';
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);
  const request = useRef(0);
  const inFlight = useRef(false);
  const blocked = !!props.disabled || props.editable === false || !!props.isLoading;
  const latest = useRef({
    amount: props.amount,
    unit: props.unit,
    entry: usdcEntry,
    blocked,
    onQuoteRefreshChange,
  });
  latest.current = { amount: props.amount, unit: props.unit, entry: usdcEntry, blocked, onQuoteRefreshChange };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current += 1;
      if (inFlight.current) {
        inFlight.current = false;
        latest.current.onQuoteRefreshChange(false);
      }
    };
  }, []);
  const now = useXbtPriceClock(usdcEntry?.quote);
  const sats = new BigNumber(props.amount || 0).times(props.unit === BitcoinUnit.BTC ? 100000000 : 1);
  const validSats = sats.isInteger() && sats.gte(0) && sats.lte('2100000000000000');
  const disabled = blocked || refreshing;
  let conversionError = '';
  if (usdcEntry) {
    try {
      usdcToSendSats(usdcEntry.text, usdcEntry.quote, asset, now);
    } catch (error) {
      conversionError = (error as Error).message;
    }
  }
  const applyEntry = (text: string, quote: SendUsdcQuote) => {
    let converted = '';
    try {
      converted = usdcToSendSats(text, quote, asset);
    } catch {
      /* Invalid drafts clear the spend amount. */
    }
    onSatsChange(converted, undefined, { text, quote });
  };
  const refreshQuote = async () => {
    if (!mounted.current || latest.current.blocked || inFlight.current) return;
    const start = latest.current;
    const startingSats = new BigNumber(start.amount || 0).times(start.unit === BitcoinUnit.BTC ? 100000000 : 1);
    inFlight.current = true;
    const id = ++request.current;
    setRefreshing(true);
    onQuoteRefreshChange(true);
    try {
      const fresh = asset === 'BTC' ? await fetchNeoxexBtcPrice() : await fetchNeoxexPrice();
      if (!mounted.current || id !== request.current || latest.current.blocked) return;
      if (latest.current.amount !== start.amount || latest.current.unit !== start.unit || latest.current.entry !== start.entry) return;
      const quote = toSendUsdcQuote(asset, fresh);
      applyEntry(start.entry?.text ?? sendSatsToUsdc(startingSats.toFixed(), quote, asset), quote);
    } catch (error) {
      if (mounted.current && id === request.current) Alert.alert('USDC entry unavailable', (error as Error).message);
    } finally {
      if (id === request.current) inFlight.current = false;
      if (mounted.current && id === request.current) {
        setRefreshing(false);
        onQuoteRefreshChange(false);
      }
    }
  };
  const enterUsdc = () => {
    try {
      const quote = toSendUsdcQuote(asset, asset === 'BTC' ? btcUsdcPriceQuote : xbtPriceQuote);
      applyEntry(sendSatsToUsdc(sats.toFixed(), quote, asset), quote);
    } catch (error) {
      Alert.alert('USDC entry unavailable', (error as Error).message, [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Refresh quote',
          onPress: () => {
            refreshQuote();
          },
        },
      ]);
    }
  };
  const rotate = () => {
    if (disabled || props.amount === BitcoinUnit.MAX) return;
    if (usdcEntry) {
      // Leaving USDC explicitly selects the current coin amount without repricing.
      onSatsChange(validSats ? sats.toFixed(0) : '', validSats ? sats.div(100000000).toFixed() : '');
    } else if (props.unit === BitcoinUnit.SATS) {
      enterUsdc();
    } else if (validSats) {
      onSatsChange(sats.toFixed(0));
    }
  };

  return (
    <View>
      {usdcEntry ? (
        <View>
          <View style={styles.row}>
            <View style={styles.rail} />
            <View style={styles.amount}>
              <TextInput
                testID="SendUsdcInput"
                accessibilityLabel="Send amount in USDC"
                keyboardType="decimal-pad"
                inputAccessoryViewID={props.inputAccessoryViewID}
                placeholder="0"
                maxLength={64}
                editable={!disabled}
                value={usdcEntry.text}
                style={[styles.input, usdcEntry.text.length > 10 && styles.smallInput, { color: colors.alternativeTextColor2 }]}
                onChangeText={text => applyEntry(text.trim().replace(',', '.'), usdcEntry.quote)}
              />
              <Text style={[styles.unit, { color: colors.alternativeTextColor2 }]}>USDC</Text>
            </View>
            <TouchableOpacity
              testID="changeAmountUnitButton"
              disabled={disabled}
              accessibilityRole="button"
              accessibilityLabel={`Change USDC to ${asset}`}
              onPress={rotate}
              style={styles.rail}
            >
              <Image source={require('../img/round-compare-arrows-24-px.png')} />
            </TouchableOpacity>
          </View>
          <Text testID="SendUsdcConversion" style={[styles.caption, { color: colors.alternativeTextColor }]}>
            {conversionError || `≈ ${sats.div(100000000).toFixed()} ${asset} · ${sats.toFormat(0)} sats`}
          </Text>
          <Text style={[styles.caption, { color: colors.alternativeTextColor }]}>
            {`NeoxEX · 1 ${asset} ≈ ${new BigNumber(usdcEntry.quote.pricePerCoin).toFormat()} USDC`}
          </Text>
          <Text style={[styles.caption, { color: colors.alternativeTextColor }]}>
            {`Last trade ${new Date(usdcEntry.quote.updatedAt).toLocaleString()} · Network fee extra`}
          </Text>
          <TouchableOpacity testID="RefreshSendUsdcQuote" disabled={disabled} accessibilityRole="button" onPress={refreshQuote}>
            <Text style={[styles.caption, { color: colors.foregroundColor }]}>{refreshing ? 'Refreshing quote…' : 'Refresh quote'}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <AmountInput {...props} disabled={disabled} onPressUnit={rotate} />
          {refreshing && <Text style={[styles.caption, { color: colors.alternativeTextColor }]}>Refreshing quote…</Text>}
          {validSats &&
            (asset === 'BTC' ? (
              <BtcUsdcEstimate satoshis={sats.toNumber()} style={[styles.caption, { color: colors.alternativeTextColor }]} />
            ) : (
              <XbtFiatEstimate satoshis={sats.toNumber()} style={styles.caption} />
            ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingTop: 16 },
  rail: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  amount: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    fontSize: 36,
    fontWeight: 'bold',
    textAlign: 'right',
    minWidth: 28,
    flexShrink: 1,
    padding: 2,
  },
  smallInput: { fontSize: 20 },
  unit: { fontSize: 15, fontWeight: '600', marginLeft: 4 },
  caption: { fontSize: 13, textAlign: 'center', marginTop: 6 },
});
