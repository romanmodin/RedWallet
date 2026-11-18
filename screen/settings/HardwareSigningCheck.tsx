import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import BlueText from '../../components/BlueText';
import Button from '../../components/Button';
import loc from '../../loc';
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
  const scrollView = useRef<ScrollView>(null);
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

  // Scanner navigation can restore the scroll position above or below the result.
  // Make either verdict immediately visible when returning to this screen.
  useEffect(() => {
    if (focused && result) scrollView.current?.scrollTo({ y: 0, animated: false });
  }, [focused, result]);

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
            else setError(loc.hardware_check.invalid_account);
          }
        },
      });
    } catch {
      if (lifetime.current.active && token === lifetime.current.generation) setError(loc.hardware_check.scanner_error);
    } finally {
      if (pendingPermission.current === token) {
        pendingPermission.current = null;
        if (lifetime.current.active) setBusy(false);
      }
    }
  };

  return (
    <ScrollView
      ref={scrollView}
      testID="HardwareSigningCheck"
      style={{ backgroundColor: colors.elevated }}
      contentContainerStyle={styles.content}
    >
      <BlueText style={styles.heading}>{loc.hardware_check.heading}</BlueText>
      {result && (
        <>
          <BlueSpacing20 />
          <BlueText
            testID={result === 'passed' ? 'HardwareCheckPassed' : 'HardwareCheckFailed'}
            style={result === 'passed' ? styles.success : styles.error}
          >
            {result === 'passed' ? loc.hardware_check.passed : loc.hardware_check.failed}
          </BlueText>
        </>
      )}
      <BlueSpacing20 />
      <BlueText>{loc.hardware_check.intro}</BlueText>
      <BlueSpacing20 />
      {!check ? (
        <>
          <BlueText>{loc.hardware_check.export_help}</BlueText>
          <BlueSpacing20 />
          <Button
            title={loc.hardware_check.scan_account}
            testID="HardwareCheckScanAccount"
            disabled={busy}
            onPress={() => scan('account')}
          />
        </>
      ) : (
        <>
          <BlueText testID="HardwareCheckAccount">
            {loc.formatString(loc.hardware_check.account, { path: check.account.accountPath })}
          </BlueText>
          <BlueText>{loc.formatString(loc.hardware_check.fingerprint, { fingerprint: check.account.fingerprint.toUpperCase() })}</BlueText>
          <BlueSpacing20 />
          <BlueText style={styles.heading}>{loc.hardware_check.test_amounts}</BlueText>
          <BlueText>{loc.formatString(loc.hardware_check.recipient, { amount: check.review.recipientSat })}</BlueText>
          <BlueText>{loc.formatString(loc.hardware_check.change, { amount: check.review.changeSat })}</BlueText>
          <BlueText>{loc.formatString(loc.hardware_check.fee, { amount: check.review.feeSat })}</BlueText>
          <BlueSpacing20 />
          {!showRequest ? (
            <Button title={loc.hardware_check.show_request} testID="HardwareCheckShowRequest" onPress={() => setShowRequest(true)} />
          ) : (
            <>
              <BlueText>{loc.hardware_check.sign_help}</BlueText>
              <BlueSpacing20 />
              {focused && result !== 'passed' && (
                <View style={styles.qr} testID="HardwareCheckRequest">
                  <DynamicQRCode key={check.review.unsignedPsbtSha256} value={check.requestHex} forceProtocol="URv2" />
                </View>
              )}
              <BlueSpacing20 />
              {result !== 'passed' && (
                <Button
                  title={loc.hardware_check.scan_signature}
                  testID="HardwareCheckScanSignature"
                  disabled={busy}
                  onPress={() => scan('signature')}
                />
              )}
              <BlueSpacing20 />
              <BlueText>{loc.hardware_check.limits}</BlueText>
            </>
          )}
          <BlueSpacing20 />
          <Button title={loc.hardware_check.reset} testID="HardwareCheckReset" onPress={reset} />
        </>
      )}
      {!!error && (
        <BlueText testID="HardwareCheckError" style={styles.error}>
          {error}
        </BlueText>
      )}
      <BlueSpacing20 />
      <BlueText>{loc.hardware_check.privacy}</BlueText>
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
