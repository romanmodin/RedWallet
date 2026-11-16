import React, { useEffect, useRef, useState } from 'react';
import { NativeModules, StyleSheet, TextInput } from 'react-native';
import { SettingsFootnote, SettingsListItem, SettingsSection } from './SettingsSection';
import { useTheme } from './themes';

type NameState = { saved: string; active: string; restartRequired: boolean };
const bridge = NativeModules.XBTLightningBridge;

export default function XBTLightningNodeName({ status, busy }: { status: string; busy: boolean }) {
  const { colors } = useTheme();
  const [name, setName] = useState('');
  const [state, setState] = useState<NameState>();
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reload, setReload] = useState(0);
  const initialized = useRef(false);
  const mounted = useRef(false);
  const pending = useRef(false);
  const revision = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (pending.current) return;
    const request = ++revision.current;
    let canceled = false;
    bridge
      .nodeName('get', '')
      .then((next: NameState) => {
        if (canceled || !mounted.current || request !== revision.current) return;
        setState(next);
        setLoaded(true);
        setError('');
        if (!initialized.current) {
          setName(next.saved);
          initialized.current = true;
        }
      })
      .catch(() => {
        if (!canceled && mounted.current && request === revision.current) {
          setLoaded(true);
          setError('Could not read the saved node name. Retry or enter and save a replacement.');
        }
      });
    return () => {
      canceled = true;
    };
  }, [status, reload]);
  const save = async () => {
    if (pending.current || busy || !loaded) return;
    pending.current = true;
    revision.current += 1;
    setSaving(true);
    setError('');
    try {
      const next: NameState = await bridge.nodeName('save', name);
      if (mounted.current) {
        initialized.current = true;
        setState(next);
        setName(next.saved);
      }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not save the node name. Try again.');
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };
  return (
    <SettingsSection>
      <SettingsListItem title="Node name" subtitle={state?.active ? 'Current: ' + state.active : 'Used when your Lightning node starts'} />
      <TextInput
        accessibilityLabel="Lightning node name"
        placeholder="RedWallet"
        placeholderTextColor={colors.alternativeTextColor2}
        value={name}
        onChangeText={setName}
        editable={loaded && !busy && !saving}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={32}
        style={[styles.input, { color: colors.foregroundColor, backgroundColor: colors.inputBackgroundColor }]}
      />
      <SettingsListItem
        title={saving ? 'Saving node name…' : 'Save node name'}
        disabled={!loaded || busy || saving || !name.trim() || name === state?.saved}
        onPress={save}
      />
      {state && (
        <SettingsFootnote>
          {state.restartRequired
            ? 'Name saved. After payments finish, fully close and reopen RedWallet to apply it. Your node identity and channels stay the same.'
            : 'Saved name: ' + state.saved}
        </SettingsFootnote>
      )}
      {error ? <SettingsFootnote>{error}</SettingsFootnote> : null}
      {!state && error ? <SettingsListItem title="Retry loading node name" onPress={() => setReload(value => value + 1)} /> : null}
      <SettingsFootnote>
        This name can be visible to other Lightning users. Maximum 32 bytes; some characters use more than one byte.
      </SettingsFootnote>
    </SettingsSection>
  );
}
const styles = StyleSheet.create({ input: { padding: 14, borderRadius: 10, marginHorizontal: 14 } });
