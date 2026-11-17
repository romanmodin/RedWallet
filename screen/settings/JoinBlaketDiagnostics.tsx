import React, { useEffect, useRef, useState } from 'react';
import { AppState, NativeModules, Platform, View } from 'react-native';
import BlueText from '../../components/BlueText';
import Button from '../../components/Button';
import { BlueSpacing20 } from '../../components/BlueSpacing';
import { DirectoryProbeError, probeDirectory, ProbeStage } from '../../class/joinblaket/directory-probe';

const progress: Record<ProbeStage, string> = {
  identity: 'Preparing a temporary identity…',
  authentication: 'Connecting and authenticating through Tor…',
  orderbook: 'Reading certified market offers…',
};

/** Deliberate diagnostic under Self-test; importing or visiting never opens Tor. */
export default function JoinBlaketDiagnostics() {
  const active = useRef<AbortController | undefined>(undefined);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Check the directory and market through Tor.');
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') active.current?.abort();
    });
    return () => {
      mounted.current = false;
      active.current?.abort();
      subscription.remove();
    };
  }, []);

  const run = async () => {
    if (active.current || AppState.currentState !== 'active') return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    try {
      const found = await probeDirectory({
        signal: controller.signal,
        onStage: stage => {
          if (mounted.current && active.current === controller) setStatus(progress[stage]);
        },
      });
      if (mounted.current && !controller.signal.aborted) {
        setStatus(`Tor authentication passed. Certified offers: ${found.certifiedOffers}. Makers: ${found.makers}.`);
      }
    } catch (error) {
      if (mounted.current) {
        const message =
          error instanceof DirectoryProbeError ? `Check ${error.reason} during ${error.stage}.` : 'Could not complete the directory check.';
        setStatus(message);
      }
    } finally {
      if (active.current === controller) active.current = undefined;
      if (mounted.current) setBusy(false);
    }
  };

  if (Platform.OS !== 'ios' || typeof NativeModules.XBTLightningBridge?.joinblaket !== 'function') return null;
  return (
    <View>
      <BlueSpacing20 />
      <BlueText bold>JOINBLAKET CONNECTION CHECK</BlueText>
      <BlueText>Reads public offers only. No wallet coins are used. Keep the app open.</BlueText>
      <BlueSpacing20 />
      <Button title="Check JoinBlaket market" testID="JoinBlaketProbeStart" onPress={run} disabled={busy} />
      {busy && <Button title="Cancel check" testID="JoinBlaketProbeCancel" onPress={() => active.current?.abort()} />}
      <BlueSpacing20 />
      <BlueText testID="JoinBlaketProbeStatus">{status}</BlueText>
      <BlueText>Bond and coin checks are not included. Payments remain unavailable.</BlueText>
    </View>
  );
}
