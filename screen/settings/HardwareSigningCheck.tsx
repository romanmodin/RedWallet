import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import BlueText from '../../components/BlueText';
import Button from '../../components/Button';
import { DynamicQRCode } from '../../components/DynamicQRCode';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { useTheme } from '../../components/themes';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { requestCameraAuthorization } from '../../helpers/scan-qr';
import {
  createHardwareSigningFixture,
  parseHardwareCheckAccount,
  verifyHardwareSigningFixture,
  PublicAccount,
} from '../../class/hardware/offline-signing';

type Check = {
  account: PublicAccount;
  requestHex: string;
  review: ReturnType<typeof createHardwareSigningFixture>['review'];
};

const HardwareSigningCheck = () => {
  const navigation = useExtendedNavigation();
  const { colors } = useTheme();
  const focused = useIsFocused();
  const [check, setCheck] = useState<Check>();
  const [showRequest, setShowRequest] = useState(false);
  const [result, setResult] = useState<'passed' | 'failed'>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lifetime = useRef({ active: true, generation: 0 });
  const pendingPermission = useRef<number | null>(null);

  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    return () => {
      current.active = false;
      current.generation++;
    };
  }, []);

  const reset = () => {
    lifetime.current.generation++;
    pendingPermission.current = null;
    setBusy(false);
    setCheck(undefined);
    setShowRequest(false);
    setResult(undefined);
    setError('');
  };

  const scan = async (kind: 'account' | 'signature') => {
    if (pendingPermission.current !== null || (kind === 'signature' && (!check || !showRequest))) return;
    const original = check;
    const token = ++lifetime.current.generation;
    pendingPermission.current = token;
    setBusy(true);
    setError('');
    if (kind === 'signature') setResult(undefined);
    try {
      await requestCameraAuthorization();
      if (!lifetime.current.active || token !== lifetime.current.generation) return;
      let delivered = false;
      navigation.navigate('ScanQRCode', {
        showFileImportButton: true,
        onBarScanned: (text: string) => {
          if (!lifetime.current.active || delivered || token !== lifetime.current.generation) return;
          delivered = true;
          try {
            if (kind === 'account') {
              const account = parseHardwareCheckAccount(text);
              const fixture = createHardwareSigningFixture(account);
              setCheck({ account, requestHex: fixture.request.toHex(), review: fixture.review });
              setShowRequest(false);
              setResult(undefined);
            } else if (original) {
              if (typeof text !== 'string' || text.length > 64 * 1024) throw new Error('Invalid response size');
              verifyHardwareSigningFixture(original.account, Buffer.from(text, 'utf8'));
              setResult('passed');
            }
          } catch {
            if (kind === 'signature') setResult('failed');
            else setError('Scan a public Native SegWit account export. Never enter a seed or private key.');
          }
        },
      });
    } catch {
      if (lifetime.current.active && token === lifetime.current.generation) setError('The scanner could not be opened. Please try again.');
    } finally {
      if (pendingPermission.current === token) {
        pendingPermission.current = null;
        if (lifetime.current.active) setBusy(false);
      }
    }
  };

  return (
    <ScrollView testID="HardwareSigningCheck" style={{ backgroundColor: colors.elevated }} contentContainerStyle={styles.content}>
      <BlueText style={styles.heading}>Offline hardware check</BlueText>
      <BlueSpacing20 />
      <BlueText>
        This checks QR transfer and a signature without spending funds. The test transaction cannot be broadcast successfully.
      </BlueText>
      <BlueSpacing20 />
      {!check ? (
        <>
          <BlueText>
            On your hardware wallet, choose a public account export such as Connect Sparrow. Your seed stays on the device.
          </BlueText>
          <BlueSpacing20 />
          <Button title="Scan public account" testID="HardwareCheckScanAccount" disabled={busy} onPress={() => scan('account')} />
        </>
      ) : (
        <>
          <BlueText testID="HardwareCheckAccount">Native SegWit · {check.account.accountPath}</BlueText>
          <BlueText>Fingerprint: {check.account.fingerprint.toUpperCase()}</BlueText>
          <BlueSpacing20 />
          <BlueText style={styles.heading}>Test amounts only</BlueText>
          <BlueText>Recipient: {check.review.recipientSat} sats</BlueText>
          <BlueText>Change: {check.review.changeSat} sats</BlueText>
          <BlueText>Fee: {check.review.feeSat} sats</BlueText>
          <BlueSpacing20 />
          {!showRequest ? (
            <Button title="Show test QR" testID="HardwareCheckShowRequest" onPress={() => setShowRequest(true)} />
          ) : (
            <>
              <BlueText>Scan with your hardware wallet, review these amounts, then sign. If the device refuses, stop this check.</BlueText>
              <BlueSpacing20 />
              {focused && result !== 'passed' && (
                <View style={styles.qr} testID="HardwareCheckRequest">
                  <DynamicQRCode key={check.review.unsignedPsbtSha256} value={check.requestHex} forceProtocol="URv2" />
                </View>
              )}
              <BlueSpacing20 />
              {result === 'passed' ? (
                <BlueText testID="HardwareCheckPassed" style={styles.success}>
                  Offline signature verified
                </BlueText>
              ) : (
                <Button
                  title="Scan signed response"
                  testID="HardwareCheckScanSignature"
                  disabled={busy}
                  onPress={() => scan('signature')}
                />
              )}
              {result === 'failed' && (
                <BlueText testID="HardwareCheckFailed" style={styles.error}>
                  The signature did not match this test. Check the device response and try scanning again.
                </BlueText>
              )}
              <BlueSpacing20 />
              <BlueText>This result covers this offline test only. Real payments and chain separation were not tested.</BlueText>
            </>
          )}
          <BlueSpacing20 />
          <Button title="Start over" testID="HardwareCheckReset" onPress={reset} />
        </>
      )}
      {!!error && (
        <BlueText testID="HardwareCheckError" style={styles.error}>
          {error}
        </BlueText>
      )}
      <BlueSpacing20 />
      <BlueText>This check does not add a wallet or contact a server. Public account and test data are not saved.</BlueText>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  content: { padding: 20, paddingBottom: 40 },
  heading: { fontSize: 20, fontWeight: '700' },
  qr: { alignItems: 'center' },
  success: { color: '#137A51', fontWeight: '700', fontSize: 18 },
  error: { color: '#B51F32', marginTop: 16 },
});
export default HardwareSigningCheck;
