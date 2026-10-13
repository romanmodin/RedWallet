import React, { useEffect, useState } from 'react';
import { Alert, TextInput, View, StyleSheet } from 'react-native';
import { getHomeReference, setHomeReference } from '../blue_modules/chain-freshness';
import Button from './Button';
import { SettingsFootnote, SettingsSection, settingsCardContent } from './SettingsSection';
import { useTheme } from './themes';

export default function ChainReferenceSettings() {
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const { colors } = useTheme();
  useEffect(() => {
    let mounted = true;
    getHomeReference()
      .then(reference => {
        if (mounted) setUrl(reference?.url || '');
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);
  const save = async () => {
    setSaving(true);
    try {
      await setHomeReference(url);
      Alert.alert(
        'Chain reference saved',
        'This optional Knots reference is linked to your selected Electrum server. Tap the chain indicator to retry verification.',
      );
    } catch (error) {
      Alert.alert('Reference not saved', error instanceof Error ? error.message : 'Unable to save reference.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <SettingsSection title="Chain freshness checks">
      <View style={settingsCardContent}>
        <SettingsFootnote>
          Checks on app opening and hourly while active compare your Electrum chain with mempool.guide. Only public block data is requested;
          wallet addresses are never sent. Warnings do not block access to your wallet or change your server.
        </SettingsFootnote>
        <TextInput
          testID="KnotsReferenceURL"
          accessibilityLabel="Optional read-only Knots HTTPS reference"
          placeholder="Optional Knots HTTPS reference URL"
          placeholderTextColor="#81868e"
          value={url}
          onChangeText={setUrl}
          editable={!saving}
          keyboardType="url"
          autoCorrect={false}
          autoCapitalize="none"
          style={[styles.input, { color: colors.foregroundColor, borderColor: colors.formBorder }]}
        />
        <SettingsFootnote>
          Optional: your own metadata-only endpoint, not a Knots RPC URL. No RPC passwords belong in this app. Being away from home does not
          block your receiving address. Clear the field to remove the optional reference.
        </SettingsFootnote>
        <Button title="Save chain reference" testID="SaveKnotsReference" disabled={saving} onPress={save} />
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create({ input: { borderWidth: 1, borderRadius: 8, padding: 12 } });
