import React, { useEffect, useRef, useState } from 'react';
import { Alert, NativeModules, Share, Text, TextInput } from 'react-native';
import { SettingsFootnote, SettingsListItem, SettingsScrollView, SettingsSection } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';

const bridge = NativeModules.XBTLightningBridge;
type Review = { invoice: string; hash: string; sats: string; destination: string };

export default function XBTLightning() {
  const { colors } = useTheme();
  const [status, setStatus] = useState('Checking');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState('');
  const [incoming, setIncoming] = useState('');
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
      const next = await bridge.run(action);
      if (mounted.current) setStatus(next);
    });
  useEffect(() => {
    mounted.current = true;
    node('status');
    return () => {
      mounted.current = false;
    };
  }, []);
  const confirm = (payment: Review) =>
    Alert.alert('Pay test invoice?', payment.sats + ' test sats to ' + payment.destination + '. Maximum routing fee: 10 test sats.', [
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
          Private XBT test network (regtest). This test wallet uses a chain peer on localhost, port 18444.
        </SettingsFootnote>
        <SettingsListItem title="Node status" subtitle={busy ? 'Working…' : status} />
        {status === 'Stopped' && <SettingsListItem title="Start test node" disabled={busy} onPress={() => node('start')} />}
        {(status === 'Needs setup' || status === 'Locked') && (
          <SettingsListItem
            title={status === 'Locked' ? 'Unlock test wallet' : 'Create test wallet'}
            disabled={busy}
            onPress={() => node('setup')}
          />
        )}
        <SettingsListItem title="Refresh status" disabled={busy} onPress={() => node('status')} />
      </SettingsSection>
      {['RPC ready', 'Running'].includes(status) && (
        <SettingsSection>
          <TextInput
            style={{ color: colors.foregroundColor }}
            accessibilityLabel="Test sats to receive"
            placeholder="Test sats to receive"
            keyboardType="number-pad"
            value={amount}
            onChangeText={setAmount}
          />
          <SettingsListItem
            title="Create test invoice"
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
            accessibilityLabel="Test invoice to pay"
            placeholder="Paste a regtest invoice"
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
            title="Review test invoice"
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
              title={'Pay ' + review.sats + ' test sats'}
              disabled={busy || pendingPayment.current === review.hash}
              onPress={() => confirm(review)}
            />
          )}
          <SettingsListItem
            title="Recent test payments"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const history = await bridge.run('history');
                if (mounted.current) setMessage(history);
              })
            }
          />
          <SettingsListItem
            title="Export static channel backup"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const url = await bridge.run('backup');
                if (mounted.current) await Share.share({ url });
              })
            }
          />
        </SettingsSection>
      )}
      {!!message && <SettingsFootnote>{message}</SettingsFootnote>}
    </SettingsScrollView>
  );
}
