import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SettingsFootnote, SettingsListItem } from './SettingsSection';
import { useTheme } from './themes';
import { BridgeController, BridgeHistoryEntry, SwapRecord } from '../blue_modules/lightning-bridge/state';
import { historyDescription } from '../blue_modules/lightning-bridge/history';
import { crossChainBridge } from '../blue_modules/lightning-bridge/runtime';
import { formatMsat, readBridgeInvoice } from '../blue_modules/lightning-bridge/invoice';
import { LightningBridgeProvider, lightningBridgeProviders, priceMsat } from '../blue_modules/lightning-bridge/provider';

type Props = {
  invoice?: string;
  initialHash?: string;
  feeLimit?: string;
  onClose: () => void;
  authorize?: (action: (isCurrent: () => boolean) => Promise<void>) => Promise<boolean>;
  canSubmit?: () => boolean;
  hideHistoryAmounts?: boolean;
  controller?: BridgeController;
  providers?: readonly LightningBridgeProvider[];
};
const pending = (r?: SwapRecord) => !!r && ['submitting', 'pending', 'unknown'].includes(r.state);
const coin = (msat: bigint) => {
  const scale = 100000000000n;
  const decimals = (msat % scale).toString().padStart(11, '0').replace(/0+$/, '');
  return (msat / scale).toString() + (decimals ? '.' + decimals : '') + ' XBT';
};
export const bridgeStatusText = (r: SwapRecord) => {
  if (r.state === 'settled') return 'Payment succeeded · verified by XBT LND';
  if (r.state === 'failed') return 'Payment failed · XBT LND confirms no settled payment';
  if (pending(r)) return 'Payment pending or uncertain. Do not pay again. Reconnect to this XBT node to check settlement.';
  if (r.state === 'canceled') return 'Canceled before submission. No payment sent.';
  if (r.state === 'quote_expired') return 'Quote expired before submission. No payment sent.';
  if (r.state === 'requesting') return 'RedWallet saved the quote request. No quote result or payment submission was recorded.';
  if (r.state === 'quote_failed') return 'Quote request failed. No payment submitted by RedWallet.';
  return 'Quote ready. Payment requires your confirmation.';
};

export default function CrossChainLightning({
  invoice,
  initialHash,
  feeLimit = '10',
  onClose,
  authorize,
  canSubmit = () => true,
  hideHistoryAmounts = false,
  controller = crossChainBridge,
  providers = lightningBridgeProviders,
}: Props) {
  const { colors } = useTheme();
  const selectionColor = '#B62032';
  const settledColor = '#147648';
  const [selected, setSelected] = useState<string>();
  const [record, setRecord] = useState<SwapRecord>();
  const [history, setHistory] = useState<BridgeHistoryEntry[]>([]);
  const [opened, setOpened] = useState<BridgeHistoryEntry>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(Date.now());
  const alive = useRef(true),
    working = useRef(false),
    polling = useRef(false);
  const abort = useRef<AbortController | undefined>(undefined);
  const approvalEpoch = useRef(0);
  const current = useRef(record);
  current.current = record;
  const active = () => alive.current && !['background', 'inactive'].includes(AppState.currentState) && canSubmit();
  const refresh = async () => {
    const item = current.current;
    if (!item || polling.current || !active()) return;
    polling.current = true;
    try {
      const next = await controller.refresh(item.hash, new AbortController().signal);
      if (alive.current && current.current?.hash === item.hash && current.current?.node === item.node) setRecord(next);
    } catch {
      if (alive.current && current.current?.hash === item.hash && current.current?.node === item.node)
        setMessage('Status unavailable. No payment will be retried.');
    } finally {
      polling.current = false;
    }
  };
  const openHistory = (entry: BridgeHistoryEntry) => {
    current.current = entry.record;
    setRecord(entry.record);
    setOpened(entry);
    setMessage('');
  };
  useEffect(() => {
    alive.current = true;
    if (!invoice)
      controller
        .history()
        .then(items => {
          if (alive.current) {
            setHistory(items);
            const entry = items.find(item => item.hash === initialHash);
            if (entry) openHistory(entry);
          }
        })
        .catch(() => {
          if (alive.current) setMessage('Could not read secure cross-chain history. Start or unlock the XBT node and try again.');
        });
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(() => {
      if (pending(current.current)) refresh();
    }, 5000);
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
      else {
        approvalEpoch.current += 1;
        abort.current?.abort();
      }
    });
    return () => {
      alive.current = false;
      approvalEpoch.current += 1;
      abort.current?.abort();
      clearInterval(clock);
      clearInterval(poll);
      listener.remove();
    };
    // Lifetime is one invoice/modal. The parent keys it when input changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const getQuote = async () => {
    if (!invoice || !selected || working.current || !active()) return;
    working.current = true;
    setBusy(true);
    setMessage('');
    const request = new AbortController();
    abort.current = request;
    try {
      const result = await controller.quote(selected, readBridgeInvoice(invoice), feeLimit, request.signal);
      if (alive.current) setRecord(result);
    } catch (e) {
      if (alive.current) setMessage(e instanceof Error ? e.message : 'Could not obtain a quote.');
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const close = async () => {
    abort.current?.abort();
    if (record?.state === 'quoted') {
      try {
        await controller.cancel(record.hash);
      } catch {
        setMessage('Could not save cancellation. No payment was submitted.');
        return;
      }
    }
    onClose();
  };
  const pay = async () => {
    if (!record?.quote || !authorize || working.current || !active()) return;
    const reviewed = record;
    let approvalAttempted = false;
    working.current = true;
    setBusy(true);
    setMessage('');
    try {
      const authorized = await authorize(async isCurrent => {
        // Capture after Face ID has returned to the foreground. A later
        // interruption invalidates approval even if the app is active again.
        const epoch = approvalEpoch.current;
        const canPay = () => approvalEpoch.current === epoch && AppState.currentState === 'active' && active() && isCurrent();
        approvalAttempted = true;
        const result = await controller.approve(reviewed.hash, reviewed.quote!.holdInvoice, canPay);
        if (alive.current) setRecord(result);
      });
      if (!authorized && alive.current) setMessage('Action canceled. Nothing was submitted.');
    } catch (e) {
      if (alive.current) setMessage(e instanceof Error ? e.message : 'Payment outcome is uncertain. Check status.');
      if (approvalAttempted) {
        // Submission can succeed while the final Keychain write fails. Replace
        // stale review UI with durable state; unreadable history stays uncertain.
        let next: SwapRecord = { ...reviewed, state: 'unknown' };
        try {
          next = (await controller.list()).find(item => item.hash === reviewed.hash && item.node === reviewed.node) ?? next;
        } catch {
          /* Keep an uncertain display until the node/storage reconnects. */
        }
        if (alive.current) setRecord(next);
      }
    } finally {
      working.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const q = record?.quote;
  const providerName = (id: string) => providers.find(provider => provider.id === id)?.name ?? id;
  const seconds = q ? Math.max(0, Math.floor(q.expiresAt - now / 1000)) : 0;
  const hidden = !invoice && hideHistoryAmounts;
  const field = (label: string, value: string) => (
    <Text style={[styles.line, { color: colors.foregroundColor }]}>
      {label}: {hidden ? '••••' : value}
    </Text>
  );
  return (
    <Modal
      visible
      animationType="slide"
      onRequestClose={() => {
        if (!busy) close();
      }}
    >
      <View style={[styles.modal, { backgroundColor: colors.background }]}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.foregroundColor }]}>
            {opened
              ? 'Cross-chain payment details'
              : record
                ? 'Pay SHA256 Lightning'
                : invoice
                  ? 'Choose Lightning processor'
                  : 'Cross-chain Lightning history'}
          </Text>
          {!record && invoice && (
            <>
              <SettingsFootnote>
                Select a processor before sharing this invoice and requesting a quote. Nothing is paid at this step.
              </SettingsFootnote>
              {providers.map(provider => (
                <TouchableOpacity
                  key={provider.id}
                  accessibilityRole="radio"
                  accessibilityState={{
                    checked: selected === provider.id,
                    disabled: busy,
                  }}
                  accessibilityLabel={provider.name}
                  disabled={busy}
                  onPress={() => setSelected(provider.id)}
                  style={[
                    styles.provider,
                    {
                      borderColor: selected === provider.id ? selectionColor : colors.hdborderColor,
                    },
                  ]}
                >
                  <Text style={[styles.providerName, { color: colors.foregroundColor }]}>
                    {provider.name}
                    {selected === provider.id ? ' • Selected' : ''}
                  </Text>
                  <Text style={{ color: colors.alternativeTextColor2 }}>{provider.website}</Text>
                  <Text style={{ color: colors.alternativeTextColor2 }}>XBT → SHA256 Lightning</Text>
                </TouchableOpacity>
              ))}
              <SettingsFootnote>Only verified integrations appear here. Additional processors can be added independently.</SettingsFootnote>
              <SettingsListItem title="Get quote" disabled={!selected || busy} onPress={getQuote} />
            </>
          )}
          {!opened &&
            !invoice &&
            history.map(item => (
              <SettingsListItem
                key={item.hash}
                title={'XBT → SHA-256 · ' + (item.record?.state ?? 'Quote request')}
                subtitle={hidden ? '••••' : new Date(item.at).toLocaleString()}
                onPress={() => openHistory(item)}
              />
            ))}
          {record && (
            <>
              <Text
                style={[
                  styles.status,
                  {
                    color: record.state === 'settled' ? settledColor : colors.foregroundColor,
                  },
                ]}
              >
                {bridgeStatusText(record)}
              </Text>
              <Text style={[styles.line, { color: colors.foregroundColor }]}>Processor: {providerName(record.provider)}</Text>
              {field('Time', new Date(record.createdAt).toLocaleString())}
              {opened && !q && !opened.issues.some(issue => issue.at >= record.createdAt) && (
                <SettingsFootnote>No further details were saved for this attempt.</SettingsFootnote>
              )}
              {q && (
                <>
                  {field('Recipient invoice amount', formatMsat(q.originalMsat) + ' SHA256 sats')}
                  {field('Exchange rate', '1 XBT = ' + q.rate + ' SHA256')}
                  {field('Bridge spread', (q.spread * 100).toFixed(4).replace(/0+$/, '').replace(/\.$/, '') + '%')}
                  {field(
                    'Bridge charge including rounding',
                    formatMsat((BigInt(q.payMsat) - priceMsat(q.originalMsat, q.rate, 0)).toString()) + ' XBT sats',
                  )}
                  {field('XBT to processor', coin(BigInt(q.payMsat)))}
                  {field(
                    'Estimated routing fee (lower bound)',
                    record.estimatedFeeMsat ? formatMsat(record.estimatedFeeMsat) + ' XBT sats' : 'Unavailable',
                  )}
                  {field('Maximum routing fee', record.feeLimit + ' XBT sats')}
                  {field('Maximum total XBT required', coin(BigInt(q.payMsat) + BigInt(record.feeLimit) * 1000n))}
                  {record.actualFeeMsat !== undefined && field('Actual routing fee', formatMsat(record.actualFeeMsat) + ' XBT sats')}
                  {record.state === 'quoted' && (
                    <Text style={[styles.line, { color: colors.foregroundColor }]}>
                      Quote expires in {seconds} s · Confirm needs at least 15 s remaining
                    </Text>
                  )}
                  {opened && field('Quote expires', new Date(q.expiresAt * 1000).toLocaleString())}
                  {field('Original invoice', q.original)}
                  {field('Payment reference', record.hash)}
                  <SettingsFootnote>
                    Independent third-party swap service. Liquidity, availability and counterparty risks apply. If the destination payment
                    fails, XBT LND must confirm failure before funds are treated as released. A pending hold can last until its timelock (
                    {q.cltv} blocks), beyond quote expiration.
                  </SettingsFootnote>
                  {record.state === 'quoted' && authorize && (
                    <SettingsListItem title="Confirm and pay" disabled={busy || seconds < 15} onPress={pay} />
                  )}
                </>
              )}
              {pending(record) && <SettingsListItem title="Check settlement" disabled={busy} onPress={refresh} />}
            </>
          )}
          {opened && opened.issues.length > 0 && (
            <>
              <Text accessibilityRole="header" style={[styles.status, { color: colors.foregroundColor }]}>
                Recent attempts for this invoice
              </Text>
              {opened.issues.map((issue, index) => (
                <View key={issue.at + '-' + index}>
                  <Text style={[styles.line, { color: colors.foregroundColor }]}>
                    {providerName(issue.provider)} · {hidden ? '••••' : new Date(issue.at).toLocaleString()}
                  </Text>
                  <SettingsFootnote>{historyDescription(issue)}</SettingsFootnote>
                </View>
              ))}
            </>
          )}
          {opened && !initialHash && (
            <SettingsListItem
              title="Back to history"
              disabled={busy}
              onPress={async () => {
                current.current = undefined;
                setRecord(undefined);
                setOpened(undefined);
                setMessage('');
                try {
                  const entries = await controller.history();
                  if (alive.current) setHistory(entries);
                } catch {
                  if (alive.current) setMessage('Could not refresh cross-chain history.');
                }
              }}
            />
          )}
          {!!message && <SettingsFootnote>{message}</SettingsFootnote>}
          {busy && <ActivityIndicator accessibilityLabel="Processing bridge request" />}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ disabled: busy }}
            disabled={busy}
            onPress={close}
            style={[
              styles.closeButton,
              { backgroundColor: colors.buttonBackgroundColor, borderColor: colors.hdborderColor },
              busy && styles.disabledButton,
            ]}
          >
            <Text style={[styles.closeLabel, { color: colors.buttonTextColor }]}>
              {pending(record) ? 'Close · payment remains tracked' : 'Cancel / Close'}
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  modal: { flex: 1, paddingTop: 56 },
  content: { padding: 20, paddingBottom: 50 },
  closeButton: {
    alignSelf: 'center',
    maxWidth: '100%',
    minHeight: 48,
    marginTop: 14,
    paddingHorizontal: 22,
    paddingVertical: 10,
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
  },
  closeLabel: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  disabledButton: { opacity: 0.5 },
  heading: { fontSize: 24, fontWeight: '700', marginBottom: 20 },
  provider: {
    padding: 16,
    marginVertical: 8,
    borderWidth: 2,
    borderRadius: 14,
  },
  providerName: { fontSize: 20, fontWeight: '600', marginBottom: 6 },
  line: { fontSize: 15, marginVertical: 6 },
  status: { fontSize: 17, fontWeight: '600', marginVertical: 12 },
});
