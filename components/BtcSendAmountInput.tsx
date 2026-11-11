import React, { useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import BigNumber from 'bignumber.js';
import { AmountInput } from './AmountInput';
import BtcUsdcEstimate from './BtcUsdcEstimate';
import { useSettings } from '../hooks/context/useSettings';
import { BitcoinUnit } from '../models/bitcoinUnits';
import { BtcUsdcPriceQuote } from '../blue_modules/btc-usdc-price';
import { usdcToSendSats } from '../blue_modules/send-usdc';
import { useTheme } from './themes';
type Props = React.ComponentProps<typeof AmountInput> & {
  onSatsChange: (sats: string, btc?: string) => void;
};
export default function BtcSendAmountInput({ onSatsChange, ...props }: Props) {
  const { btcUsdcPriceQuote } = useSettings();
  const { colors } = useTheme();
  const [quote, setQuote] = useState<BtcUsdcPriceQuote | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const sats = new BigNumber(props.amount || 0).times(props.unit === BitcoinUnit.BTC ? 100000000 : 1);
  useEffect(() => {
    if (props.unit !== BitcoinUnit.SATS || props.amount === BitcoinUnit.MAX) {
      setQuote(null);
      setError('');
    }
  }, [props.unit, props.amount]);
  const disabled = !!props.disabled || !!props.isLoading;
  if (props.assetTicker !== 'BTC') return <AmountInput {...props} />;
  const enterQuote = () => {
    if (disabled) return;
    try {
      if (!btcUsdcPriceQuote) throw new Error('BTC/USDC price is unavailable.');
      usdcToSendSats('0', btcUsdcPriceQuote);
      if (!sats.isInteger() || sats.lt(0) || sats.gt('2100000000000000')) throw new Error('Enter a valid satoshi amount.');
      setDraft(sats.div(100000000).times(btcUsdcPriceQuote.pricePerBtc).toFixed());
      setQuote({ ...btcUsdcPriceQuote });
      setError('');
    } catch (e) {
      Alert.alert('USDC entry unavailable', (e as Error).message);
    }
  };
  return (
    <View>
      {quote ? (
        <View>
          <TextInput
            testID="SendUsdcInput"
            accessibilityLabel="Send amount in USDC"
            keyboardType="decimal-pad"
            maxLength={40}
            editable={!disabled}
            value={draft}
            style={[styles.input, { color: colors.alternativeTextColor2 }]}
            onChangeText={text => {
              const value = text.replace(',', '.');
              setDraft(value);
              try {
                const converted = usdcToSendSats(value, quote);
                onSatsChange(converted);
                setError('');
              } catch (e) {
                onSatsChange('');
                setError(value ? (e as Error).message : '');
              }
            }}
          />
          <TouchableOpacity
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel="Change USDC to BTC"
            onPress={() => {
              onSatsChange(sats.toFixed(0), sats.div(100000000).toFixed());
              setQuote(null);
              setError('');
            }}
          >
            <Text style={[styles.center, { color: colors.foregroundColor }]}>USDC · Change to BTC</Text>
          </TouchableOpacity>
          <Text style={[styles.center, { color: colors.alternativeTextColor }]}>
            {error || `${props.amount || '0'} sats · rounded down`}
          </Text>
        </View>
      ) : (
        <AmountInput
          {...props}
          onPressUnit={props.unit === BitcoinUnit.SATS && props.amount !== BitcoinUnit.MAX ? enterQuote : undefined}
        />
      )}
      {sats.isInteger() && sats.gte(0) && sats.lte('2100000000000000') && (
        <BtcUsdcEstimate satoshis={sats.toNumber()} style={[styles.estimate, { color: colors.alternativeTextColor }]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: { fontSize: 36, textAlign: 'center' },
  center: { textAlign: 'center' },
  estimate: { textAlign: 'center', marginTop: 8 },
});
