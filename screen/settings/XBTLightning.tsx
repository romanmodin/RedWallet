import { keepLocalCopy, pick, types } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, NativeModules, Share, Text, TextInput } from 'react-native';
import { SettingsFootnote, SettingsListItem, SettingsScrollView, SettingsSection } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';

const bridge = NativeModules.XBTLightningBridge;
type Review = {
  invoice: string;
  hash: string;
  sats: string;
  destination: string;
};

export default function XBTLightning() {
  const { colors } = useTheme();
  const [peer, setPeer] = useState('');
  const [status, setStatus] = useState('Checking');
  const [message, setMessage] = useState('');
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [amount, setAmount] = useState('');
  const [incoming, setIncoming] = useState('');
  const [lightningPeer, setLightningPeer] = useState('');
  const [outgoing, setOutgoing] = useState('');
  const [review, setReview] = useState<Review>();
  const pending = useRef(false);
  const mounted = useRef(false);
  const pendingPayment = useRef<string | undefined>(undefined);
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (err) {
      if (mounted.current) setMessage(err instanceof Error ? err.message : 'The Lightning node could not answer.');
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const node = (action: string) =>
    run(async () => {
      const next = await bridge.run(action, peer);
      if (mounted.current) setStatus(next);
    });
  useEffect(() => {
    mounted.current = true;
    let active = true;
    bridge.run('status', '').then(
      (value: string) => {
        if (active) setStatus(value);
      },
      () => {
        if (active) setMessage('Could not read the test node status.');
      },
    );
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!['Starting', 'Unlocked', 'RPC ready', 'Syncing'].includes(status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const detail = await bridge.run('progress', '');
        if (active) setProgress(detail);
        const next = await bridge.run('status', '');
        if (active) setStatus(next);
      } catch {
        if (active) setMessage('The node has not answered yet. Check the chain peer connection.');
      }
      if (active) timer = setTimeout(refresh, 3000);
    };
    timer = setTimeout(refresh, 3000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status]);
  const confirm = (payment: Review) =>
    Alert.alert('Pay invoice?', payment.sats + ' sats to ' + payment.destination + '. Maximum routing fee: 10 sats.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Pay',
        onPress: () =>
          run(async () => {
            if (pendingPayment.current === payment.hash) return;
            pendingPayment.current = payment.hash;
            setReview(undefined);
            try {
              const settled = await bridge.invoice('pay', payment.invoice, payment.hash, payment.sats);
              if (!settled) pendingPayment.current = undefined;
              if (mounted.current) setMessage(settled ? 'Payment settled.' : 'Payment failed. Check channel balance and routing.');
            } catch {
              if (mounted.current) setMessage('Payment outcome unknown. Check the node payment history before trying again.');
            }
          }),
      },
    ]);
  return (
    <SettingsScrollView testID="XBTLightningScreen">
      <SettingsSection>
        <SettingsFootnote>
          XBT Lightning runs on this iPhone and connects to public XBT chain peers. Leave the peer blank to use the built-in list, or enter
          your own compact-filter chain peer as host:port. Your home node is optional.
        </SettingsFootnote>
        {status === 'Stopped' && (
          <TextInput
            style={{ color: colors.foregroundColor }}
            accessibilityLabel="Optional XBT chain peer"
            placeholder="Automatic XBT peers, or host:port"
            autoCapitalize="none"
            autoCorrect={false}
            value={peer}
            onChangeText={setPeer}
            keyboardType="url"
            editable={!busy}
          />
        )}
        {['Starting', 'Unlocked', 'RPC ready', 'Syncing'].includes(status) && (
          <SettingsFootnote>
            The node is starting or syncing. Status updates automatically. If this does not advance, the configured chain peer may be
            unreachable.
          </SettingsFootnote>
        )}
        {!!progress && <SettingsFootnote>{progress}</SettingsFootnote>}
        <SettingsListItem title="Node status" subtitle={busy ? 'Working…' : status} />
        {status === 'Stopped' && <SettingsListItem title="Start XBT node" disabled={busy} onPress={() => node('start')} />}
        {(status === 'Needs setup' || status === 'Locked') && (
          <SettingsListItem
            title={status === 'Locked' ? 'Unlock Lightning wallet' : 'Create Lightning wallet'}
            disabled={busy}
            onPress={() => node('setup')}
          />
        )}
        <SettingsListItem title="Refresh status" disabled={busy} onPress={() => node('status')} />
      </SettingsSection>
      {status === 'Running' && (
        <SettingsSection>
          <SettingsListItem
            title="Node and channel balances"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const result = await bridge.run('details', '');
                if (mounted.current) setMessage(result);
              })
            }
          />
          <SettingsListItem
            title="Get XBT funding address"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const address = await bridge.run('fund', '');
                if (mounted.current) setMessage(address);
              })
            }
          />
          <TextInput
            accessibilityLabel="Lightning peer"
            style={{ color: colors.foregroundColor }}
            placeholder="pubkey@host:port"
            value={lightningPeer}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            onChangeText={setLightningPeer}
          />
          <SettingsListItem
            title="Connect Lightning peer"
            disabled={busy || !lightningPeer}
            onPress={() =>
              run(async () => {
                const result = await bridge.invoice('connect', lightningPeer.trim(), '', '');
                if (mounted.current) setMessage(result);
              })
            }
          />
          <SettingsListItem
            title="Open private channel"
            disabled={busy || !lightningPeer}
            onPress={() => {
              const key = lightningPeer.trim().split('@')[0];
              Alert.alert('Open a private channel?', 'Commit 100,000 sats at 1 sat/vB to ' + key, [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Open channel',
                  onPress: () =>
                    run(async () => {
                      const point = await bridge.invoice('open', key, '', '100000');
                      if (mounted.current) setMessage('Funding transaction: ' + point);
                    }),
                },
              ]);
            }}
          />
          <TextInput
            style={{ color: colors.foregroundColor }}
            accessibilityLabel="Sats to receive"
            placeholder="Sats to receive"
            keyboardType="number-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <SettingsListItem
            title="Create invoice"
            disabled={busy || !/^[1-9][0-9]{0,6}$/.test(amount)}
            onPress={() =>
              run(async () => {
                const invoice = await bridge.invoice('receive', '', '', amount);
                if (mounted.current) setIncoming(invoice);
              })
            }
          />
          {!!incoming && (
            <Text selectable style={{ color: colors.foregroundColor }}>
              {incoming}
            </Text>
          )}
          <TextInput
            style={{ color: colors.foregroundColor }}
            accessibilityLabel="Invoice to pay"
            placeholder="Paste a reginvoice"
            autoCapitalize="none"
            autoCorrect={false}
            value={outgoing}
            onChangeText={value => {
              setReview(undefined);
              setOutgoing(value);
            }}
            editable={!busy}
          />
          <SettingsListItem
            title="Review invoice"
            disabled={busy || !outgoing.trim()}
            onPress={() =>
              run(async () => {
                const invoice = outgoing.trim();
                const decoded = await bridge.invoice('decode', invoice, '', '');
                if (mounted.current) setReview({ ...decoded, invoice });
              })
            }
          />
          {review && (
            <SettingsListItem
              title={'Pay ' + review.sats + ' sats'}
              disabled={busy || pendingPayment.current === review.hash}
              onPress={() => confirm(review)}
            />
          )}
          <SettingsListItem
            title="Recent payments"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const history = await bridge.run('history', '');
                if (mounted.current) setMessage(history);
              })
            }
          />
          <SettingsListItem
            title="Export static channel backup"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const url = await bridge.run('backup', '');
                if (mounted.current) await Share.share({ url });
              })
            }
          />
        </SettingsSection>
      )}
      {['Needs setup', 'Running'].includes(status) && (
        <SettingsSection>
          <SettingsFootnote>
            Portable Lightning recovery saves the wallet seed and static channel backup together. Keep the passphrase separately. Export
            again after channel changes.
          </SettingsFootnote>
          <TextInput
            style={{ color: colors.foregroundColor }}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Backup passphrase"
            placeholder="Backup passphrase (12 or more characters)"
            value={phrase}
            onChangeText={setPhrase}
            editable={!busy}
          />
          {status === 'Needs setup' ? (
            <SettingsListItem
              title="Restore Lightning wallet from file"
              disabled={busy || phrase.length < 12}
              onPress={() =>
                Alert.alert(
                  'Restore to this iPhone?',
                  'Take the original node offline first. Static channel recovery can close channels and return funds on-chain.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Choose recovery file',
                      onPress: () =>
                        run(async () => {
                          const password = phrase;
                          setPhrase('');
                          const [file] = await pick({ type: [types.allFiles] });
                          const [copy] = await keepLocalCopy({
                            files: [
                              {
                                uri: file.uri,
                                fileName: 'selected-mainnet-recovery.rwln',
                              },
                            ],
                            destination: 'cachesDirectory',
                          });
                          if (copy.status !== 'success') throw Error('Could not read the selected backup.');
                          try {
                            await bridge.recovery('restore', password, copy.localUri);
                            const next = await bridge.run('status', '');
                            if (mounted.current) setStatus(next);
                          } finally {
                            await RNFS.unlink(decodeURIComponent(copy.localUri.replace(/^file:\/\//, ''))).catch(() => {});
                          }
                        }),
                    },
                  ],
                )
              }
            />
          ) : (
            <SettingsListItem
              title="Export encrypted Lightning recovery file"
              disabled={busy || phrase.length < 12}
              onPress={() =>
                run(async () => {
                  const password = phrase;
                  setPhrase('');
                  const url = await bridge.recovery('export', password, '');
                  try {
                    if (mounted.current) await Share.share({ url });
                  } finally {
                    await RNFS.unlink(decodeURIComponent(url.replace(/^file:\/\//, ''))).catch(() => {});
                  }
                })
              }
            />
          )}
        </SettingsSection>
      )}
      {!!message && (
        <Text selectable style={{ color: colors.foregroundColor }}>
          {message}
        </Text>
      )}
    </SettingsScrollView>
  );
}
