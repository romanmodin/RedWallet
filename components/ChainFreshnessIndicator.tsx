import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import * as BlueElectrum from '../blue_modules/BlueElectrum';
import { checkChain } from '../blue_modules/chain-freshness';
import { ChainStatus, chainStatusTitle, CHAIN_CHECK_INTERVAL_MS, CHAIN_RETRY_MS } from '../class/xbt/chain-freshness';

export function useChainFreshness(disabled: boolean) {
  const [status, setStatus] = useState<ChainStatus>({ state: 'checking', serverLabel: 'Electrum', message: '', references: [] });
  const latest = useRef(status);
  const generation = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const running = useRef(false);
  const run = useCallback(async () => {
    if (disabled || AppState.currentState === 'background' || running.current) return;
    running.current = true;
    const version = generation.current;
    setStatus({ ...latest.current, state: 'checking' });
    try {
      const next = await checkChain(latest.current);
      if (version !== generation.current) return;
      latest.current = next;
      setStatus(next);
      if (retry.current) clearTimeout(retry.current);
      if (next.state === 'suspect')
        retry.current = setTimeout(() => {
          run().catch(() => {});
        }, CHAIN_RETRY_MS);
    } finally {
      if (version === generation.current) running.current = false;
    }
  }, [disabled]);
  useEffect(() => {
    generation.current++;
    running.current = false;
    latest.current = { state: 'checking', serverLabel: 'Electrum', message: '', references: [] };
    if (!disabled) run().catch(() => {});
    const connection = BlueElectrum.subscribeConnectionState(state => {
      generation.current++;
      running.current = false;
      if (retry.current) clearTimeout(retry.current);
      latest.current = {
        state: 'unverified',
        serverLabel: 'Electrum',
        message: 'Connection changed; verification pending.',
        references: [],
      };
      setStatus(latest.current);
      if (state === 'connected') run().catch(() => {});
    });
    const lifecycle = AppState.addEventListener('change', state => {
      if (state === 'active') run().catch(() => {});
      else {
        generation.current++;
        running.current = false;
        if (retry.current) clearTimeout(retry.current);
      }
    });
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') run().catch(() => {});
    }, CHAIN_CHECK_INTERVAL_MS);
    return () => {
      // This ref is a sequence counter, not a captured native view reference.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      running.current = false;
      connection();
      lifecycle.remove();
      clearInterval(interval);
      if (retry.current) clearTimeout(retry.current);
    };
  }, [disabled, run]);
  return { status, retry: run };
}

export default function ChainFreshnessIndicator({ status, retry }: { status: ChainStatus; retry: () => void }) {
  const { width } = useWindowDimensions();
  const maxWidth = Math.max(140, Math.min(250, width - 175));
  const color = status.state === 'verified' ? '#30C48D' : status.state === 'checking' ? '#92979E' : '#FFBF32';
  const title = chainStatusTitle(status);
  const showDetails = () => {
    const checked = status.checkedAt ? new Date(status.checkedAt).toLocaleString() : 'Not yet checked';
    const verified = status.verifiedAt ? new Date(status.verifiedAt).toLocaleString() : 'Not yet verified';
    const sources = status.references.map(r => `${r.source}: block ${r.height}`).join('\n');
    Alert.alert(
      'Chain connection',
      `${status.message}\n\nYour ${status.serverLabel}: ${status.height ?? 'unavailable'}\n${sources}\nLast checked: ${checked}\nLast verified: ${verified}\n\nThis check never sends wallet addresses or changes your selected server.`,
      [
        { text: 'Close', style: 'cancel' },
        { text: 'Retry', onPress: retry },
      ],
    );
  };
  return (
    <Pressable
      testID="ChainFreshnessIndicator"
      accessibilityRole="button"
      accessibilityLabel={`${title}. Tap for connection details`}
      onPress={showDetails}
      style={[styles.container, { maxWidth }]}
    >
      <Text style={[styles.icon, { color }]}>{status.state === 'verified' ? '✓' : status.state === 'checking' ? '◷' : '⚠'}</Text>
      <View style={styles.copy}>
        <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={[styles.title, { color }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.subtitle}>
          Tap to check connection
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', minHeight: 44 },
  icon: { fontSize: 25, marginRight: 8 },
  copy: { flexShrink: 1 },
  title: { fontSize: 15, fontWeight: '600' },
  subtitle: { fontSize: 11, color: '#92979E', marginTop: 2 },
});
