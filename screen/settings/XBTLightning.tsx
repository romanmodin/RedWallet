import React, { useEffect, useRef, useState } from 'react';
import { NativeModules } from 'react-native';
import { SettingsFootnote, SettingsListItem, SettingsScrollView, SettingsSection } from '../../components/SettingsSection';

type Action = 'start' | 'setup' | 'status';
export default function XBTLightning() {
  const [status, setStatus] = useState('Checking');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(false);
  const run = async (action: Action) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const next = await NativeModules.XBTLightningBridge.run(action);
      if (mounted.current) setStatus(next);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'The Lightning node could not answer.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  useEffect(() => {
    mounted.current = true;
    run('status');
    return () => {
      mounted.current = false;
    };
  }, []);
  return (
    <SettingsScrollView testID="XBTLightningScreen">
      <SettingsSection>
        <SettingsFootnote>
          Private XBT test network (regtest). This node has its own test wallet on this iPhone. Its chain peer is localhost on port 18444.
        </SettingsFootnote>
        <SettingsListItem title="Node status" subtitle={busy ? 'Working…' : status} />
        {status === 'Stopped' && <SettingsListItem title="Start test node" disabled={busy} onPress={() => run('start')} />}
        {(status === 'Needs setup' || status === 'Locked') && (
          <SettingsListItem
            title={status === 'Locked' ? 'Unlock test wallet' : 'Create test wallet'}
            disabled={busy}
            onPress={() => run('setup')}
          />
        )}
        <SettingsListItem title="Refresh status" disabled={busy} onPress={() => run('status')} />
        {!!error && <SettingsFootnote>{error}</SettingsFootnote>}
      </SettingsSection>
    </SettingsScrollView>
  );
}
