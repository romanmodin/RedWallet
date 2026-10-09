import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';

import Button from '../../components/Button';
import { SettingsFootnote, SettingsScrollView, SettingsSection, settingsCardContent } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';
import { useSettings } from '../../hooks/context/useSettings';
import { useXbtPriceClock } from '../../hooks/useXbtPriceClock';

const XbtPrice: React.FC = () => {
  const { xbtPriceQuote, saveManualXbtPriceQuote, clearXbtPriceQuote, refreshNeoxexXbtPriceQuote } = useSettings();
  const { colors } = useTheme();
  const [price, setPrice] = useState(xbtPriceQuote?.pricePerXbt ?? '');
  const [currency, setCurrency] = useState(xbtPriceQuote?.currency ?? 'USD');
  const [isWorking, setIsWorking] = useState(false);
  const operationInProgress = useRef(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [messageTarget, setMessageTarget] = useState<'manual' | 'market'>('manual');
  const now = useXbtPriceClock(xbtPriceQuote);

  useEffect(() => {
    setPrice(xbtPriceQuote?.pricePerXbt ?? '');
    setCurrency(xbtPriceQuote?.currency ?? 'USD');
  }, [xbtPriceQuote]);

  const save = useCallback(async () => {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    setMessageTarget('manual');
    Keyboard.dismiss();
    setIsWorking(true);
    setError('');
    setStatus('');
    try {
      await saveManualXbtPriceQuote(price, currency);
      setStatus('Saved');
    } catch (saveError: unknown) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      operationInProgress.current = false;
      setIsWorking(false);
    }
  }, [price, currency, saveManualXbtPriceQuote]);

  const clear = useCallback(async () => {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    setMessageTarget('manual');
    Keyboard.dismiss();
    setIsWorking(true);
    setError('');
    setStatus('');
    try {
      await clearXbtPriceQuote();
      setPrice('');
      setCurrency('USD');
      setStatus('Cleared');
    } catch (clearError: unknown) {
      setError(clearError instanceof Error ? clearError.message : String(clearError));
    } finally {
      operationInProgress.current = false;
      setIsWorking(false);
    }
  }, [clearXbtPriceQuote]);

  const refresh = useCallback(async () => {
    if (operationInProgress.current) return;
    operationInProgress.current = true;
    setMessageTarget('market');
    Keyboard.dismiss();
    setIsWorking(true);
    setError('');
    setStatus('');
    try {
      await refreshNeoxexXbtPriceQuote();
      setStatus('Refreshed from NeoxEX');
    } catch (refreshError: unknown) {
      const message = refreshError instanceof Error ? refreshError.message : String(refreshError);
      setError(`Unable to refresh from NeoxEX: ${message}`);
    } finally {
      operationInProgress.current = false;
      setIsWorking(false);
    }
  }, [refreshNeoxexXbtPriceQuote]);

  const inputStyle = [styles.input, { color: colors.foregroundColor, borderColor: colors.formBorder }];
  const isStale = xbtPriceQuote?.source === 'neoxex' && now - xbtPriceQuote.updatedAt >= 15 * 60 * 1000;
  const operationError = error ? (
    <Text testID="XbtPriceError" accessibilityLiveRegion="polite" style={styles.error}>
      {error}
    </Text>
  ) : null;
  const operationStatus = status ? (
    <SettingsFootnote testID="XbtPriceStatus" accessibilityLiveRegion="polite" style={styles.help}>
      {status}
    </SettingsFootnote>
  ) : null;

  return (
    <SettingsScrollView testID="XbtPriceScreen" keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets>
      <SettingsSection title="Market price">
        <View style={settingsCardContent}>
          <SettingsFootnote>
            Refresh the latest reported XBT/USDC trade from NeoxEX. The quote currency is USDC. Saved NeoxEX quotes refresh when the app
            opens or returns to the foreground. Manual prices stay unchanged.
          </SettingsFootnote>
          <View style={styles.button}>
            <Button testID="RefreshNeoxexXbtPrice" onPress={refresh} title="Refresh from NeoxEX" disabled={isWorking} />
          </View>
          {messageTarget === 'market' && operationError}
          {messageTarget === 'market' && operationStatus}
        </View>
      </SettingsSection>

      <SettingsSection title="Manual price">
        <View style={settingsCardContent}>
          <SettingsFootnote>
            Enter your estimate for the value of XBT. It is used to display approximate balances and does not update automatically.
          </SettingsFootnote>
          <Text style={[styles.label, { color: colors.foregroundColor }]}>Price of 1 XBT</Text>
          <TextInput
            testID="XbtPriceInput"
            accessibilityLabel="Price of 1 XBT"
            value={price}
            onChangeText={value => {
              setPrice(value);
              setStatus('');
              setError('');
            }}
            editable={!isWorking}
            keyboardType="decimal-pad"
            autoCorrect={false}
            placeholder="0.00"
            placeholderTextColor={colors.alternativeTextColor}
            style={inputStyle}
          />
          <Text style={[styles.label, { color: colors.foregroundColor }]}>Quote currency</Text>
          <TextInput
            testID="XbtQuoteCurrencyInput"
            accessibilityLabel="Quote currency"
            value={currency}
            onChangeText={value => {
              setCurrency(value.toUpperCase());
              setStatus('');
              setError('');
            }}
            editable={!isWorking}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            placeholder="USD"
            placeholderTextColor={colors.alternativeTextColor}
            style={inputStyle}
          />
          <SettingsFootnote style={styles.help}>
            Use 2–12 letters or digits, such as USD or USDC. USD and USDC are separate quotes.
          </SettingsFootnote>
          {messageTarget === 'manual' && operationError}
          <View style={styles.button}>
            <Button testID="SaveXbtPrice" onPress={save} title="Save" disabled={isWorking} />
          </View>
          <View style={styles.button}>
            <Button testID="ClearXbtPrice" onPress={clear} title="Clear" disabled={isWorking} />
          </View>
          {messageTarget === 'manual' && operationStatus}
        </View>
      </SettingsSection>

      <SettingsSection title="Saved quote">
        <View style={settingsCardContent}>
          {xbtPriceQuote ? (
            <>
              <Text testID="XbtPriceSavedQuote" style={[styles.savedQuote, { color: colors.foregroundColor }]}>
                1 XBT = {xbtPriceQuote.pricePerXbt} {xbtPriceQuote.currency}
              </Text>
              <SettingsFootnote testID="XbtPriceSource">Source: {xbtPriceQuote.source === 'neoxex' ? 'NeoxEX' : 'Manual'}</SettingsFootnote>
              <SettingsFootnote testID="XbtPriceTimestamp">
                {xbtPriceQuote.source === 'neoxex' ? 'Last trade' : 'Updated'}: {new Date(xbtPriceQuote.updatedAt).toLocaleString()}
              </SettingsFootnote>
              {isStale && (
                <SettingsFootnote testID="XbtPriceStale" style={styles.help}>
                  Stale: quote is at least 15 minutes old.
                </SettingsFootnote>
              )}
            </>
          ) : (
            <SettingsFootnote testID="XbtPriceNoQuote">No price saved. Balances are shown in XBT or sats.</SettingsFootnote>
          )}
        </View>
      </SettingsSection>
    </SettingsScrollView>
  );
};

export default XbtPrice;

const styles = StyleSheet.create({
  label: {
    marginTop: 20,
    marginBottom: 8,
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 17,
    minHeight: 48,
  },
  help: {
    marginTop: 12,
  },
  error: {
    color: '#C32632',
    marginTop: 12,
    fontSize: 14,
  },
  button: {
    marginTop: 16,
  },
  savedQuote: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 8,
  },
});
