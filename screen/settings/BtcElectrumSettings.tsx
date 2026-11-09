import React, { useEffect, useRef, useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';

import * as BtcElectrum from '../../blue_modules/BtcElectrum';
import presentAlert from '../../components/Alert';
import Button from '../../components/Button';
import {
  SettingsFootnote,
  SettingsListItem,
  SettingsScrollView,
  SettingsSection,
  settingsCardContent,
} from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';

const BtcElectrumSettings = () => {
  const { colors } = useTheme();
  const mounted = useRef(true);
  const operation = useRef(false);
  const [host, setHost] = useState('');
  const [port, setPort] = useState('50002');
  const [ssl, setSsl] = useState(true);
  const [tlsCa, setTlsCa] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');

  const fill = (server: BtcElectrum.BtcElectrumServer) => {
    setHost(server.host);
    setPort(String(server.ssl ?? server.tcp));
    setSsl(server.ssl !== undefined);
    setTlsCa(server.tlsCa || '');
  };

  useEffect(() => {
    mounted.current = true;
    let active = true;
    BtcElectrum.getPreferredServer()
      .then(server => {
        if (active) fill(server);
      })
      .catch(() => {
        if (active) setLoadError('BTC settings could not be read. Enter a server or explicitly restore the default below.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);

  const save = async () => {
    if (operation.current || loading) return;
    operation.current = true;
    Keyboard.dismiss();
    setBusy(true);
    try {
      if (!/^\d{1,5}$/.test(port.trim())) throw new Error('Enter a BTC server port from 1 to 65535.');
      const server = BtcElectrum.validateServerConfiguration({
        host,
        ...(ssl ? { ssl: Number(port), ...(tlsCa.trim() ? { tlsCa } : {}) } : { tcp: Number(port) }),
      });
      await BtcElectrum.setPreferredServer(server);
      if (!mounted.current) return;
      fill(server);
      setLoadError('');
      presentAlert({
        title: 'BTC server saved',
        message: 'Bitcoin chain checked. Open the blue BTC wallet to use this server.',
      });
    } catch (error) {
      if (mounted.current)
        presentAlert({
          title: 'BTC server not saved',
          message: (error as Error).message,
        });
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const reset = async () => {
    if (operation.current || loading) return;
    operation.current = true;
    Keyboard.dismiss();
    setBusy(true);
    try {
      await BtcElectrum.resetPreferredServer();
      if (!mounted.current) return;
      fill(BtcElectrum.DEFAULT_BTC_SERVER);
      setLoadError('');
      presentAlert({
        title: 'BTC default restored',
        message: 'The blue BTC wallet will use Blockstream over SSL. XBT server settings are separate.',
      });
    } catch {
      if (mounted.current)
        presentAlert({
          title: 'BTC default not restored',
          message: 'Could not save this change. Try again before leaving this screen.',
        });
    } finally {
      operation.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const disabled = busy || loading;
  const inputStyle = [
    styles.input,
    {
      color: colors.foregroundColor,
      borderColor: colors.formBorder,
      backgroundColor: colors.inputBackgroundColor,
    },
  ];
  const labelStyle = [styles.label, { color: colors.foregroundColor }];

  return (
    <SettingsScrollView keyboardShouldPersistTaps="handled" testID="BtcElectrumSettingsScreen">
      <SettingsSection title="BTC SHA-256 SERVER">
        <View style={settingsCardContent}>
          <SettingsFootnote>
            Bitcoin Electrum or Fulcrum server for the blue BTC wallet. These settings are separate from the XBT Fulcrum connection. Enter a
            server host, not a receiving address.
          </SettingsFootnote>
          {loadError ? <SettingsFootnote testID="BtcServerLoadError">{loadError}</SettingsFootnote> : null}
          <Text style={labelStyle}>HOST OR IP ADDRESS</Text>
          <TextInput
            testID="BtcServerHost"
            accessibilityLabel="BTC server host"
            value={host}
            onChangeText={setHost}
            placeholder="bitcoin.example.com"
            placeholderTextColor={colors.alternativeTextColor}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!disabled}
            style={inputStyle}
          />
          <Text style={labelStyle}>PORT</Text>
          <TextInput
            testID="BtcServerPort"
            accessibilityLabel="BTC server port"
            value={port}
            onChangeText={setPort}
            keyboardType="number-pad"
            maxLength={5}
            editable={!disabled}
            style={inputStyle}
          />
        </View>
        <SettingsListItem
          title="SSL"
          subtitle="Verify the server certificate"
          bottomDivider={false}
          switch={{ testID: 'BtcServerSSL', value: ssl, onValueChange: setSsl, disabled }}
        />
        <View style={settingsCardContent}>
          {ssl ? (
            <>
              <Text style={labelStyle}>TRUSTED CERTIFICATE (OPTIONAL PEM)</Text>
              <TextInput
                testID="BtcServerCertificate"
                accessibilityLabel="Trusted BTC server certificate"
                value={tlsCa}
                onChangeText={setTlsCa}
                multiline
                maxLength={16384}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!disabled}
                placeholder="-----BEGIN CERTIFICATE-----"
                placeholderTextColor={colors.alternativeTextColor}
                style={[inputStyle, styles.certificate]}
              />
              <SettingsFootnote>
                Leave blank for normal system certificate trust. Paste a certificate only from your trusted server operator.
              </SettingsFootnote>
            </>
          ) : (
            <SettingsFootnote testID="BtcServerPlaintextNotice">
              TCP is unencrypted. Use it only on a trusted private network. BTC onion connections are not supported here.
            </SettingsFootnote>
          )}
          <Button
            title="TEST AND SAVE BTC SERVER"
            testID="SaveBtcServer"
            onPress={save}
            disabled={disabled || !host.trim()}
            showActivityIndicator={busy}
          />
          <SettingsFootnote>
            Saving checks the Bitcoin chain before using this server. A custom server is never silently replaced with a public fallback.
          </SettingsFootnote>
          <Button title="RESTORE BTC DEFAULT" testID="ResetBtcServer" onPress={reset} disabled={disabled} />
          <SettingsFootnote>Default: electrum.blockstream.info, SSL port 50002. Open the blue BTC wallet to connect.</SettingsFootnote>
        </View>
      </SettingsSection>
    </SettingsScrollView>
  );
};

const styles = StyleSheet.create({
  label: {
    fontSize: 13,
    fontWeight: '400',
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 15,
  },
  certificate: { minHeight: 100, textAlignVertical: 'top', marginBottom: 8 },
});

export default BtcElectrumSettings;
