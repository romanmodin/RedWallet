import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, NativeModules, StyleSheet, TextInput, View } from 'react-native';
import { SettingsFootnote, SettingsListItem, SettingsSection } from './SettingsSection';
import { useTheme } from './themes';

type Network = {
  selected: 'direct' | 'tor';
  active: 'direct' | 'tor';
  running: boolean;
  restartRequired: boolean;
  status: string;
  defaultTower: string;
};
type Tower = {
  key: string;
  addresses: string[];
  eligible: boolean;
  sessions: string;
  acknowledged: string;
  pending: string;
};
type Props = {
  status: string;
  busy: boolean;
  run: (title: string, action: () => Promise<void>) => Promise<void>;
  report: (message: string) => void;
  onTorChange: (active: boolean) => void;
};
const bridge = NativeModules.XBTLightningBridge;

export default function XBTLightningNetwork({ status, busy, run, report, onTorChange }: Props) {
  const { colors } = useTheme();
  const [network, setNetwork] = useState<Network>();
  const [towers, setTowers] = useState<Tower[]>();
  const [uri, setURI] = useState('');
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const loading = useRef(false);
  const initialized = useRef(false);
  const acceptNetwork = useCallback(
    (value: Network) => {
      if (!mounted.current) return;
      setNetwork(value);
      onTorChange(value.running && value.active === 'tor');
      if (!initialized.current) {
        initialized.current = true;
        setURI(value.defaultTower);
      }
    },
    [onTorChange],
  );
  const refresh = useCallback(
    async (resume = false) => {
      if (loading.current || AppState.currentState === 'background' || AppState.currentState === 'inactive') return;
      loading.current = true;
      const requestRevision = revision.current;
      try {
        const nextNetwork = await bridge.network(resume ? 'resume' : 'get', '');
        if (requestRevision !== revision.current) return;
        acceptNetwork(nextNetwork);
        if (status === 'Running') {
          const items = await bridge.watchtower('list', '');
          if (mounted.current && requestRevision === revision.current) setTowers(items);
        }
        if (mounted.current) setError('');
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not check Tor or watchtower status.');
      } finally {
        loading.current = false;
      }
    },
    [acceptNetwork, status],
  );
  useEffect(() => {
    mounted.current = true;
    if (!busy) refresh();
    const timer = setInterval(() => {
      if (!busy) refresh();
    }, 15000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh(true);
    });
    return () => {
      mounted.current = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [busy, refresh]);
  const remove = (tower: Tower) =>
    Alert.alert('Remove watchtower?', 'This tower will stop receiving new protection updates. Add your replacement tower first.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () =>
          run('Remove watchtower', async () => {
            revision.current += 1;
            const items = await bridge.watchtower('remove', tower.key);
            if (mounted.current) {
              setTowers(items);
              report('Watchtower removed from future protection updates.');
            }
          }),
      },
    ]);
  if (!expanded)
    return (
      <SettingsSection>
        <SettingsListItem
          title="Tor and watchtower settings"
          subtitle={
            error ||
            `${network?.status || 'Checking connection…'} · ${towers ? `${towers.length} towers registered` : 'Protection not checked'}`
          }
          onPress={() => setExpanded(true)}
        />
      </SettingsSection>
    );
  return (
    <SettingsSection>
      <SettingsListItem title="Hide Tor and watchtower settings" onPress={() => setExpanded(false)} />
      <SettingsListItem title="Lightning connection" subtitle={network ? network.status : 'Checking connection…'} />
      <SettingsListItem
        title={network?.selected === 'tor' ? 'Use direct connection' : 'Use Tor for Lightning'}
        disabled={busy || !network}
        onPress={() =>
          run('Lightning connection', async () => {
            revision.current += 1;
            const next = await bridge.network('select', network?.selected === 'tor' ? 'direct' : 'tor');
            acceptNetwork(next);
            report(
              next.restartRequired
                ? 'Connection preference saved. Close and reopen RedWallet to apply it; your wallet and channels are retained.'
                : 'Connection preference saved. It will be used when the Lightning node starts.',
            );
          })
        }
      />
      {network?.restartRequired && <SettingsFootnote>Restart RedWallet to apply the saved connection preference.</SettingsFootnote>}
      <SettingsFootnote>
        Tor covers Lightning chain connections, peers, fee requests and watchtowers. Other RedWallet connections keep their existing
        settings. Locking the phone can still suspend the node.
      </SettingsFootnote>
      <SettingsListItem
        title="Watchtowers"
        subtitle={towers ? `${towers.length} registered` : 'Start and sync the Lightning node to check protection.'}
      />
      {error ? <SettingsFootnote>{error} Displayed information may be out of date.</SettingsFootnote> : null}
      {towers?.length === 0 && (
        <SettingsFootnote>No watchtower is registered. Add one to send channel-protection updates.</SettingsFootnote>
      )}
      {towers?.map(tower => (
        <View key={tower.key}>
          <SettingsListItem
            title={tower.addresses[0] || tower.key}
            subtitle={`${tower.acknowledged} acknowledged · ${tower.pending} pending · ${tower.sessions} sessions`}
          />
          <SettingsFootnote>
            {tower.eligible ? 'Registered for future updates.' : 'Not eligible for new sessions.'}{' '}
            {tower.acknowledged === '0'
              ? 'No protection updates acknowledged yet.'
              : 'Acknowledgments cover submitted updates; they do not prove every channel state is protected.'}
          </SettingsFootnote>
          <SettingsListItem title="Remove watchtower" disabled={busy || status !== 'Running'} onPress={() => remove(tower)} />
        </View>
      ))}
      <TextInput
        accessibilityLabel="Watchtower address"
        placeholder="Watchtower public key@host:port"
        placeholderTextColor={colors.alternativeTextColor2}
        style={[styles.input, { color: colors.foregroundColor, backgroundColor: colors.inputBackgroundColor }]}
        autoCapitalize="none"
        autoCorrect={false}
        value={uri}
        onChangeText={setURI}
        editable={!busy}
      />
      <SettingsListItem title="Use Kilombino preset" disabled={busy || !network} onPress={() => setURI(network!.defaultTower)} />
      <SettingsListItem
        title="Add watchtower"
        disabled={busy || status !== 'Running' || !uri.trim()}
        onPress={() =>
          run('Add watchtower', async () => {
            revision.current += 1;
            const items = await bridge.watchtower('add', uri.trim());
            if (mounted.current) {
              setTowers(items);
              report(
                'Watchtower registered. Check its acknowledged and pending updates below. Registration alone does not confirm channel protection.',
              );
            }
          })
        }
      />
      <SettingsFootnote>
        Use an XBT-compatible tower. Kilombino’s preset requires Tor. You can add your home tower or another tower as well. Watchtowers do
        not replace wallet recovery backups. Use the tower’s own address and key, which differ from its Lightning peer address.
      </SettingsFootnote>
      <SettingsListItem
        title="Refresh watchtower status"
        disabled={busy || status !== 'Running'}
        onPress={() =>
          run('Watchtower status', async () => {
            const items: Tower[] = await bridge.watchtower('list', '');
            if (mounted.current) {
              setTowers(items);
              report(
                items.length
                  ? items.map(t => `${t.addresses[0] || t.key}: ${t.acknowledged} acknowledged, ${t.pending} pending`).join('\n')
                  : 'No watchtower is registered.',
              );
            }
          })
        }
      />
    </SettingsSection>
  );
}

const styles = StyleSheet.create({ input: { padding: 14, borderRadius: 10, marginHorizontal: 14 } });
