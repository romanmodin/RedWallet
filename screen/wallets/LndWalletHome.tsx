import CrossChainLightning from '../../components/CrossChainLightning';
import { bridgeStore } from '../../blue_modules/lightning-bridge/runtime';
import { BridgeHistoryEntry, historyForNode } from '../../blue_modules/lightning-bridge/state';
import { formatMsat } from '../../blue_modules/lightning-bridge/invoice';
import LndBalanceBreakdown from '../../components/LndBalanceBreakdown';
import LndHistoryTabs, { LndHistoryTab } from '../../components/LndHistoryTabs';
import React, { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  NativeModules,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Ionicons from '@react-native-vector-icons/ionicons';
import { HeaderHeightContext } from '@react-navigation/elements';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import { LndActivity, LndActivityPage, LndWallet } from '../../class/wallets/lnd-wallet';
import WalletGradient from '../../class/wallet-gradient';
import LndConnectionBadge from '../../components/LndConnectionBadge';
import LndConnectionClock from '../../components/LndConnectionClock';
import { useTheme } from '../../components/themes';
import XbtFiatEstimate from '../../components/XbtFiatEstimate';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useSettings } from '../../hooks/context/useSettings';
import { formatLndAmount, nextLndDisplayUnit } from '../../blue_modules/lnd-display-amount';

const bridge = NativeModules.XBTLightningBridge;
const connectedMessage = 'Connected · Updates while this screen is open';
const refreshFailedMessage = 'Refresh failed. Showing last known data. Pull down to retry.';
const connectingStatuses = new Set(['Starting', 'Tor connecting', 'Unlocked', 'RPC ready', 'Syncing', 'Running']);
// lnrpc.PaymentFailureReason from the sender's persisted payment record.
const paymentFailureReasons = new Map<number, string>([
  [1, 'Routing timed out.'],
  [2, 'No usable route to the recipient.'],
  [3, 'The node reported a payment error.'],
  [4, 'The node reported incorrect payment details.'],
  [5, 'Insufficient spendable Lightning balance for this payment.'],
  [6, 'The payment was canceled.'],
]);
type Pages = Partial<Record<'payments' | 'invoices' | 'funding', LndActivityPage>>;
const merge = (old: LndActivity[], next: LndActivity[]) => [
  ...new Map([...old, ...next].map(row => [row.direction + row.id, row])).values(),
];

function historyTime(milliseconds: number) {
  const date = new Date(milliseconds);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function activityTitle(item: LndActivity) {
  if (item.confirmations !== undefined) return item.direction === 'sent' ? 'Withdrawal' : 'Deposit';
  if (item.state === 'settled') return undefined;
  if (item.direction === 'sent') return '↗ Payment';
  if (item.state === 'unpaid') return 'Invoice · Awaiting payment';
  return 'Invoice · ' + item.state;
}

export default function LndWalletHome({ wallet }: { wallet: LndWallet }) {
  const { colors, dark } = useTheme();
  const navigation = useExtendedNavigation();
  const { saveToDisk } = useStorage();
  const { xbtPriceQuote } = useSettings();
  const [displayUnit, setDisplayUnit] = useState(wallet.getDisplayUnit());
  const unitSaving = useRef(false);
  const formatAmount = (sats: number | string) => formatLndAmount(sats, displayUnit, xbtPriceQuote);
  const exactAmount = (sats: string) =>
    wallet.hideBalance
      ? '••••'
      : displayUnit === 'sats'
        ? formatAmount(sats)
        : formatAmount(sats) + ' (' + formatLndAmount(sats, 'sats') + ')';
  const changeDisplayUnit = async () => {
    if (unitSaving.current) return;
    unitSaving.current = true;
    const previous = wallet.getDisplayUnit();
    const previouslyHidden = wallet.hideBalance;
    const nextHidden = !previouslyHidden && previous === 'quote';
    const next = previouslyHidden ? 'XBT' : nextHidden ? previous : nextLndDisplayUnit(previous);
    wallet.hideBalance = nextHidden;
    wallet.setDisplayUnit(next);
    setDisplayUnit(next);
    redraw(value => value + 1);
    try {
      // Privacy changes need the strict storage path so failures reach this rollback.
      await saveToDisk(false, true);
    } catch {
      wallet.hideBalance = previouslyHidden;
      wallet.setDisplayUnit(previous);
      setDisplayUnit(previous);
      redraw(value => value + 1);
      Alert.alert('Unit not saved', 'Could not save your display preference. Please try again.');
    } finally {
      unitSaving.current = false;
    }
  };
  const insets = useSafeAreaInsets();
  const headerOverlayHeight = React.useContext(HeaderHeightContext) ?? insets.top;
  const balanceTop = headerOverlayHeight + 8;
  const [tab, setTab] = useState<LndHistoryTab>('transactions');
  const compactLightningActions = Platform.OS === 'ios' && tab !== 'funding';
  const footerBottom = Platform.OS === 'ios' ? Math.max(12, insets.bottom - 8) : Math.max(insets.bottom, 16);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [nativeHistory, setNativeHistory] = useState<{ node: string; pages: Pages }>();
  const [openedEntry, setOpenedEntry] = useState<{ node: string; hash: string }>();
  const [bridgeHistory, setBridgeHistory] = useState<{
    node: string;
    entries: BridgeHistoryEntry[];
    unavailable?: boolean;
  }>();
  const [refreshing, setRefreshing] = useState(false);
  const [pullRefreshing, setPullRefreshing] = useState(false);
  const [message, setMessage] = useState('Checking Lightning connection…');
  const [, redraw] = useState(0);
  const pending = useRef(false);
  const queuedRefresh = useRef<'pull' | 'automatic' | undefined>(undefined);
  const focused = useRef(false);
  const generation = useRef(0);
  const observedConnectionStart = useRef<number | undefined>(undefined);
  const [clockStart, setClockStart] = useState<number>();
  const open = useCallback((mode?: 'pay' | 'invoice' | 'send' | 'receive') => navigation.navigate('XBTLightning', { mode }), [navigation]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: wallet.getLabel(),
      headerTitleStyle: { fontSize: 19, fontWeight: '700' },
      headerTransparent: true,
      headerStyle: { backgroundColor: 'transparent' },
      headerTintColor: '#FFFFFF',
      headerLargeTitle: false,
      unstable_headerRightItems: undefined,
      // eslint-disable-next-line react/no-unstable-nested-components
      headerRight: () => (
        <Pressable accessibilityRole="button" accessibilityLabel="Lightning wallet settings" onPress={() => open()} style={styles.menu}>
          <Text style={styles.menuText}>•••</Text>
        </Pressable>
      ),
    });
  }, [navigation, wallet, open]);

  const refresh = useCallback(
    async (more = false, pulled = false) => {
      const canRefresh = () => focused.current && !['background', 'inactive'].includes(AppState.currentState);
      if (!canRefresh()) return;
      // Starting the native pull indicator programmatically can change the scroll offset on iOS.
      // Polls, foreground updates and pagination must leave it alone.
      if (pulled) setPullRefreshing(true);
      if (pending.current) {
        if (!more && (pulled || !queuedRefresh.current)) queuedRefresh.current = pulled ? 'pull' : 'automatic';
        return;
      }
      pending.current = true;
      const requestGeneration = generation.current;
      const isCurrent = () => canRefresh() && generation.current === requestGeneration;
      const requestStartedAt = performance.now();
      let shouldSave = false;
      setRefreshing(true);
      try {
        await wallet.fetchBalance().catch(error => {
          if (isCurrent()) {
            observedConnectionStart.current = undefined;
            setClockStart(undefined);
          }
          throw error;
        });
        if (!isCurrent()) return;
        if (wallet.connection() === 'connected') {
          if (observedConnectionStart.current !== undefined) {
            wallet.recordConnectionDuration(performance.now() - observedConnectionStart.current);
            shouldSave = true;
          }
          observedConnectionStart.current = undefined;
        } else if (connectingStatuses.has(wallet.status)) {
          // An already-connected first response is a warm open, not a timed startup.
          observedConnectionStart.current ??= requestStartedAt;
        } else {
          observedConnectionStart.current = undefined;
        }
        setClockStart(observedConnectionStart.current);
        redraw(value => value + 1);
        if (wallet.status !== 'Running') {
          setMessage('Node: ' + wallet.status + '. Open wallet settings to start or unlock it.');
          return;
        }
        const node = wallet.overview?.node;
        if (!node) throw new Error('Missing Lightning node identity.');
        const pages = nativeHistory?.node === node ? nativeHistory.pages : {};
        const kinds: (keyof Pages)[] = tab === 'transactions' ? ['payments', 'invoices'] : tab === 'funding' ? ['funding'] : [];
        const updates: Pages = {};
        for (const kind of kinds) {
          const previous = pages[kind];
          if (more && previous && !previous.more) continue;
          const page: LndActivityPage = await bridge.wallet(kind, more ? (previous?.next ?? '0') : '0');
          if (!isCurrent()) return;
          if (more && previous && page.more && page.next === previous.next) throw new Error('History cursor did not advance.');
          updates[kind] = {
            ...page,
            ...(previous && !more && previous.rows.length > 100 ? { next: previous.next, more: previous.more } : {}),
            rows: merge(previous?.rows ?? [], page.rows),
          };
        }
        if (tab !== 'funding' && bridge?.bridgePayment) {
          try {
            const journal = await bridgeStore.read();
            if (!isCurrent()) return;
            setBridgeHistory({ node, entries: historyForNode(journal, node) });
          } catch {
            if (!isCurrent()) return;
            setBridgeHistory(old => ({
              node,
              entries: old?.node === node ? old.entries : [],
              unavailable: true,
            }));
          }
        }
        if (!isCurrent()) return;
        if (kinds.length)
          setNativeHistory(old => ({
            node,
            pages: { ...(old?.node === node ? old.pages : {}), ...updates },
          }));
        if (updates.payments && updates.invoices) wallet.activity = [...updates.payments.rows, ...updates.invoices.rows];
        setMessage(wallet.connection() === 'connected' ? connectedMessage : 'Waiting for sync or Lightning peers');
        shouldSave = true;
      } catch {
        if (isCurrent()) setMessage(refreshFailedMessage);
      } finally {
        if (shouldSave) {
          try {
            await saveToDisk();
          } catch {
            if (isCurrent()) setMessage(refreshFailedMessage);
          }
        }
        pending.current = false;
        const next = canRefresh() ? queuedRefresh.current : undefined;
        queuedRefresh.current = undefined;
        if (focused.current) {
          setRefreshing(false);
          if (next !== 'pull') setPullRefreshing(false);
          redraw(value => value + 1);
        }
        if (next) refreshRef.current(false, next === 'pull');
      }
    },
    [wallet, tab, nativeHistory, saveToDisk],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    refreshRef.current();
  }, [tab]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      setPullRefreshing(false);
      generation.current += 1;
      let appState = AppState.currentState;
      const checkOnOpen = () => {
        const mayConnect = wallet.status === 'Checking' || connectingStatuses.has(wallet.status);
        setClockStart(mayConnect && wallet.connection() !== 'connected' ? performance.now() : undefined);
        refreshRef.current();
      };
      if (appState !== 'background' && appState !== 'inactive') checkOnOpen();
      const timer = setInterval(() => refreshRef.current(), 15000);
      const subscription = AppState.addEventListener('change', state => {
        if (state === appState) return;
        appState = state;
        generation.current += 1;
        observedConnectionStart.current = undefined;
        queuedRefresh.current = undefined;
        wallet.observedAt = 0;
        if (state === 'active') checkOnOpen();
        else setClockStart(undefined);
        redraw(value => value + 1);
      });
      return () => {
        focused.current = false;
        queuedRefresh.current = undefined;
        observedConnectionStart.current = undefined;
        setClockStart(undefined);
        generation.current += 1;
        wallet.observedAt = 0;
        clearInterval(timer);
        subscription.remove();
      };
    }, [wallet]),
  );

  const [canceledExpanded, setCanceledExpanded] = useState(false);
  const overview = wallet.overview;
  const ready = wallet.status === 'Running' && !!overview?.synced && Date.now() - wallet.observedAt <= 30_000;
  const node = overview?.node;
  const pages = nativeHistory && nativeHistory.node === node ? nativeHistory.pages : {};
  const currentBridge = bridgeHistory?.node === node ? bridgeHistory : undefined;
  const bridgeEntries = currentBridge?.entries ?? [];
  // A canceled or expired quote never submitted a native payment, even if another send uses its hash.
  const bridgePayments = new Set(
    bridgeEntries
      .filter(({ record }) => record && ['submitting', 'pending', 'unknown', 'settled', 'failed'].includes(record.state))
      .map(entry => entry.hash),
  );
  const rows = (
    tab === 'funding'
      ? [...(pages.funding?.rows ?? [])]
      : [...(pages.payments?.rows ?? []).filter(row => !bridgePayments.has(row.id)), ...(pages.invoices?.rows ?? [])]
  ).sort((a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id));
  const isCanceled = (row: LndActivity) => tab === 'transactions' && row.state === 'canceled' && row.confirmations === undefined;
  const canceled = rows.filter(isCanceled);
  const latestCanceled = canceled[0];
  const visibleRows = rows.filter(row => !isCanceled(row) || canceledExpanded || row === latestCanceled);
  const hasMore = tab === 'funding' ? pages.funding?.more : tab === 'transactions' && (pages.payments?.more || pages.invoices?.more);
  const cancelling = useRef(new Set<string>());
  const cancelInvoice = async (row: LndActivity) => {
    if (cancelling.current.has(row.id)) return;
    cancelling.current.add(row.id);
    try {
      const cancelled = await bridge.invoice('cancel', '', row.id, '');
      if (cancelled !== true) throw new Error('Cancellation was not confirmed.');
      // Only mark canceled after LND acknowledges; never infer success from dismissal.
      setNativeHistory(previous => {
        if (!previous || previous.node !== node || !previous.pages.invoices) return previous;
        const invoices = previous.pages.invoices;
        return {
          ...previous,
          pages: {
            ...previous.pages,
            invoices: {
              ...invoices,
              rows: invoices.rows.map(item => (item.id === row.id ? { ...item, state: 'canceled' } : item)),
            },
          },
        };
      });
      Alert.alert('Invoice canceled', 'This invoice can no longer be paid.');
    } catch (error) {
      Alert.alert('Cancellation not confirmed', String(error) + '\nRefresh to check whether the invoice was paid or canceled.');
    } finally {
      cancelling.current.delete(row.id);
      await refresh();
    }
  };
  const details = (row: LndActivity) => {
    const failureReason =
      row.direction === 'sent' && row.state === 'failed' && row.confirmations === undefined
        ? (paymentFailureReasons.get(row.failureReasonCode ?? 0) ?? 'No further failure detail is available.')
        : undefined;
    const text =
      exactAmount(row.sats) +
      ' · ' +
      row.state +
      (failureReason ? '\n' + failureReason : '') +
      '\nFee: ' +
      exactAmount(row.feeSats) +
      '\n' +
      (row.confirmations !== undefined ? row.confirmations + ' confirmations\nTransaction: ' : 'Payment hash: ') +
      row.id +
      (row.direction === 'received' && row.confirmations === undefined ? '\nThe sender’s identity is not supplied by Lightning.' : '') +
      (!wallet.hideBalance && row.memo ? '\n' + row.memo : '');
    const canCancel = row.direction === 'received' && row.confirmations === undefined && row.state === 'unpaid';
    Alert.alert(tab === 'funding' ? 'On-chain funding' : 'Lightning payment', text, [
      ...(canCancel
        ? [
            {
              text: 'Cancel invoice',
              style: 'destructive' as const,
              onPress: () =>
                Alert.alert(
                  'Cancel invoice?',
                  'Cancel this unpaid request for ' + exactAmount(row.sats) + '? It cannot be paid afterward.',
                  [
                    { text: 'Keep invoice', style: 'cancel' },
                    {
                      text: 'Cancel invoice',
                      style: 'destructive',
                      onPress: () => {
                        cancelInvoice(row);
                      },
                    },
                  ],
                ),
            },
          ]
        : []),
      { text: 'Copy details', onPress: () => Clipboard.setString(text) },
      { text: 'Done', style: 'cancel' },
    ]);
  };
  const action = (title: string, mode: 'pay' | 'invoice' | 'send' | 'receive', secondary = false) => (
    <Pressable
      key={mode}
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={!ready}
      onPress={() => open(mode)}
      style={[
        styles.action,
        compactLightningActions && styles.compactAction,
        secondary ? styles.fundingAction : mode === 'invoice' ? styles.receiveAction : styles.lightningAction,
        !ready && styles.disabled,
        secondary && styles.secondary,
      ]}
    >
      <Text style={[styles.actionTitle, secondary && styles.secondaryTitle]}>{mode === 'invoice' ? 'RECEIVE' : title}</Text>
      {mode === 'invoice' && <Text style={styles.actionSubtitle}>Create invoice</Text>}
    </Pressable>
  );
  const debitColor = dark ? '#FF8D96' : '#B42318';
  const renderActivity = (item: LndActivity) => {
    const sent = item.direction === 'sent';
    const title = activityTitle(item);
    const memo = !wallet.hideBalance && item.memo;
    const canceledInvoice = isCanceled(item);
    const amountColor = canceledInvoice
      ? colors.alternativeTextColor
      : sent
        ? debitColor
        : ['settled', 'confirmed'].includes(item.state)
          ? colors.successColor
          : colors.foregroundColor;
    const amount = wallet.hideBalance ? '••••' : (canceledInvoice ? '' : sent ? '−' : '+') + formatAmount(item.sats);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={(sent ? 'Sent' : 'Received') + ' · ' + item.state}
        accessibilityValue={{
          text: wallet.hideBalance ? 'Amount hidden' : amount,
        }}
        onPress={() => details(item)}
        style={[styles.row, { borderBottomColor: colors.lightBorder }]}
      >
        <View style={styles.rowBody}>
          {(title || memo) && (
            <Text
              numberOfLines={title ? undefined : 1}
              style={[
                styles.rowTitle,
                {
                  color: canceledInvoice ? colors.alternativeTextColor : colors.foregroundColor,
                },
              ]}
            >
              {title || memo}
            </Text>
          )}
          <Text style={{ color: colors.alternativeTextColor }}>
            {item.state[0].toUpperCase() + item.state.slice(1)}
            {item.confirmations !== undefined ? ' · ' + item.confirmations + ' confirmations' : ''} ·{' '}
            {item.timestamp ? historyTime(item.timestamp * 1000) : 'Time unavailable'}
          </Text>
          {!!title && !!memo && (
            <Text numberOfLines={1} style={{ color: colors.alternativeTextColor }}>
              {memo}
            </Text>
          )}
        </View>
        <View style={styles.rowValue}>
          {!title && <Text style={{ color: amountColor }}>{sent ? '↗' : '↙'}</Text>}
          <Text style={[styles.amount, { color: amountColor }]}>{amount}</Text>
        </View>
      </Pressable>
    );
  };
  const renderBridgeEntry = (entry: BridgeHistoryEntry) => {
    const record = entry.record;
    const state = record?.state.replace(/_/g, ' ');
    const status = state ? state[0].toUpperCase() + state.slice(1) : 'Quote request';
    const amount =
      record?.state === 'settled' && record.quote
        ? wallet.hideBalance
          ? '••••'
          : '−' + formatMsat(record.quote.payMsat) + ' XBT sats'
        : undefined;
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => node && setOpenedEntry({ node, hash: entry.hash })}
        style={[styles.row, { borderBottomColor: colors.lightBorder }]}
      >
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: colors.foregroundColor }]}>XBT → SHA-256</Text>
          <Text style={{ color: colors.alternativeTextColor }}>
            {status}
            {!wallet.hideBalance && ' · ' + historyTime(entry.at)}
          </Text>
        </View>
        {amount && <Text style={[styles.amount, styles.bridgeAmount, { color: debitColor }]}>{amount}</Text>}
      </Pressable>
    );
  };
  const canShowBridgeHistory = wallet.status === 'Running' && !!node && !!bridge?.bridgePayment;
  const bridgeEmpty = !bridge?.bridgePayment
    ? 'Cross-chain history requires the embedded Lightning engine.'
    : !canShowBridgeHistory
      ? 'Start or unlock the XBT node to view its cross-chain payments.'
      : currentBridge?.unavailable
        ? 'Cross-chain history could not be read. Pull down to try again.'
        : currentBridge
          ? 'No cross-chain payments yet.'
          : 'Checking cross-chain history…';
  return (
    <View testID="LndWalletHome" style={[styles.root, { backgroundColor: colors.background }]}>
      {openedEntry && openedEntry.node === node && canShowBridgeHistory && (
        <CrossChainLightning
          initialHash={openedEntry.hash}
          hideHistoryAmounts={wallet.hideBalance}
          onClose={() => setOpenedEntry(undefined)}
          canSubmit={() => focused.current}
        />
      )}
      <View
        style={[
          styles.hero,
          {
            backgroundColor: WalletGradient.xbtWallet[0],
            paddingTop: balanceTop,
            paddingLeft: 16 + insets.left,
            paddingRight: 16 + insets.right,
          },
        ]}
      >
        <LinearGradient
          colors={WalletGradient.xbtWallet}
          style={[StyleSheet.absoluteFill, { top: headerOverlayHeight }]}
          pointerEvents="none"
        />
        <View testID="LndWalletBalanceRow" style={styles.balanceRow}>
          {clockStart !== undefined && (
            <View testID="LndConnectionClockOverlay" pointerEvents="none" style={styles.clockOverlay}>
              <LndConnectionClock startedAt={clockStart} averageMs={wallet.averageConnectionDuration()} />
            </View>
          )}
          <Pressable
            style={styles.balanceButton}
            accessibilityRole="button"
            accessibilityLabel="Change wallet display unit"
            accessibilityHint="Cycles XBT, sats, the exchange-rate estimate, and hidden amounts. Tap hidden amounts to show XBT again."
            accessibilityValue={{
              text: wallet.hideBalance ? 'Amounts hidden' : displayUnit === 'quote' ? (xbtPriceQuote?.currency ?? 'Fiat') : displayUnit,
            }}
            onPress={changeDisplayUnit}
          >
            <Text testID="LndWalletBalance" style={styles.balance} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
              {wallet.hideBalance ? '••••' : formatAmount(wallet.getBalance())}
            </Text>
          </Pressable>
          <View style={styles.balanceBadge}>
            <LndConnectionBadge wallet={wallet} />
          </View>
        </View>
        <View style={styles.detailsBar}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detailsExpanded ? 'Collapse Details' : 'Expand Details'}
            accessibilityState={{ expanded: detailsExpanded }}
            onPress={() => setDetailsExpanded(expanded => !expanded)}
            style={styles.detailsToggle}
          >
            <Text style={styles.detailsTitle}>{detailsExpanded ? 'Collapse Details' : 'Expand Details'}</Text>
            <Ionicons name={detailsExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#FFE7EA" importantForAccessibility="no" />
          </Pressable>
          <View testID="LndRefreshStatus" style={styles.refreshStatus}>
            {refreshing && <ActivityIndicator size="small" color="#FFFFFF" />}
          </View>
        </View>
        {detailsExpanded && (
          <>
            <Text style={styles.balanceLabel}>Total balance · funding and channels</Text>
            {!!overview && !wallet.hideBalance && (
              <Text style={styles.status}>
                In channels {formatAmount(overview.lightningLocal)} · On-chain {formatAmount(overview.fundingTotal)}
              </Text>
            )}
            {!wallet.hideBalance && <XbtFiatEstimate satoshis={wallet.getBalance()} style={styles.fiat} />}
          </>
        )}
        {(detailsExpanded || message !== connectedMessage) && (
          <Text accessibilityLiveRegion="polite" style={styles.status}>
            {message}
          </Text>
        )}
        {detailsExpanded && (
          <Text style={styles.status}>
            {overview
              ? overview.activeChannels + (overview.activeChannels === '1' ? ' active channel' : ' active channels')
              : 'Node balance not yet available'}
          </Text>
        )}
      </View>
      <LndHistoryTabs selected={tab} onSelect={setTab} receiveColor={styles.receiveAction.backgroundColor} />
      <FlatList<LndActivity | BridgeHistoryEntry>
        key={tab}
        style={styles.history}
        data={tab === 'crossChain' ? (canShowBridgeHistory ? bridgeEntries : []) : visibleRows}
        contentInsetAdjustmentBehavior="never"
        keyExtractor={row => ('issues' in row ? row.hash : row.direction + row.id)}
        refreshControl={<RefreshControl refreshing={pullRefreshing} onRefresh={() => refresh(false, true)} />}
        contentContainerStyle={styles.historyContent}
        ListHeaderComponent={
          <>
            {tab === 'crossChain' && canShowBridgeHistory && currentBridge?.unavailable && bridgeEntries.length > 0 && (
              <Text style={[styles.historyNotice, { color: colors.alternativeTextColor }]}>
                Showing saved cross-chain activity. Pull down to try again.
              </Text>
            )}
            {tab === 'funding' && !!overview && (
              <LndBalanceBreakdown overview={overview} hidden={wallet.hideBalance === true} stale={!ready} format={formatAmount} />
            )}
            {tab === 'funding' && (
              <Text style={[styles.fundingHeading, { color: colors.foregroundColor }]}>On-chain deposits and withdrawals</Text>
            )}
            {tab === 'funding' && (
              <View style={styles.funding}>
                {!!overview && (
                  <Text style={{ color: colors.foregroundColor }}>
                    {wallet.hideBalance
                      ? '••••'
                      : formatAmount(overview.fundingConfirmed) + ' confirmed · ' + formatAmount(overview.fundingPending) + ' unconfirmed'}
                  </Text>
                )}
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          <Text style={[styles.empty, { color: colors.alternativeTextColor }]}>
            {tab === 'transactions'
              ? 'Lightning payments and invoices will appear here.'
              : tab === 'crossChain'
                ? bridgeEmpty
                : 'On-chain funding transactions will appear here.'}
          </Text>
        }
        renderItem={({ item }) =>
          'issues' in item ? (
            renderBridgeEntry(item)
          ) : item === latestCanceled ? (
            <View>
              <View style={styles.stack}>
                <View
                  pointerEvents="none"
                  style={[
                    styles.stackLayer,
                    styles.stackBack,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.lightBorder,
                    },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    styles.stackLayer,
                    styles.stackMiddle,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.lightBorder,
                    },
                  ]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'Canceled invoices · ' + canceled.length}
                  accessibilityState={{ expanded: canceledExpanded }}
                  onPress={() => setCanceledExpanded(value => !value)}
                  style={[
                    styles.stackFront,
                    {
                      backgroundColor: colors.background,
                      borderColor: colors.lightBorder,
                    },
                  ]}
                >
                  <Text style={[styles.rowTitle, { color: colors.alternativeTextColor }]}>Canceled invoices · {canceled.length}</Text>
                  <Text style={{ color: colors.alternativeTextColor }}>
                    Latest: {wallet.hideBalance ? '••••' : formatAmount(item.sats)} ·{' '}
                    {item.timestamp ? historyTime(item.timestamp * 1000) : 'Time unavailable'}
                  </Text>
                  <Text style={[styles.stackHint, { color: colors.alternativeTextColor }]}>
                    {canceledExpanded ? 'COLLAPSE ▴' : 'EXPAND ▾'}
                  </Text>
                </Pressable>
              </View>
              {canceledExpanded && renderActivity(item)}
            </View>
          ) : (
            renderActivity(item)
          )
        }
        ListFooterComponent={
          hasMore ? (
            <Pressable accessibilityRole="button" onPress={() => refresh(true)} disabled={refreshing} style={styles.load}>
              <Text style={{ color: colors.foregroundColor }}>Load older transactions</Text>
            </Pressable>
          ) : null
        }
      />
      <View
        testID="LndWalletActions"
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            // A compact 62-point Lightning button keeps at least 50 points above the iOS home inset.
            paddingBottom: footerBottom - (compactLightningActions ? 3 : 0),
            paddingLeft: 16 + insets.left,
            paddingRight: 16 + insets.right,
          },
        ]}
      >
        {!ready && (
          <Pressable accessibilityRole="button" onPress={() => open()}>
            <Text style={{ color: colors.foregroundColor }}>Open node settings · {wallet.status}</Text>
          </Pressable>
        )}
        <View testID="LndWalletActionRow" style={[styles.actions, compactLightningActions && styles.compactActionRow]}>
          {tab === 'funding' ? action('Receive on-chain', 'receive', true) : action('Receive (create invoice)', 'invoice')}
          {tab === 'funding' ? action('Send on-chain', 'send', true) : action('Pay (invoice)', 'pay')}
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  stack: { marginHorizontal: 16, marginVertical: 12, paddingBottom: 8 },
  stackLayer: {
    position: 'absolute',
    borderWidth: 1,
    borderRadius: 14,
    height: 40,
  },
  stackBack: { bottom: 0, left: 12, right: 12 },
  stackMiddle: { bottom: 4, left: 6, right: 6 },
  stackFront: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  stackHint: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  history: { flex: 1, minHeight: 0 },
  historyContent: { paddingBottom: 8 },
  detailsBar: { flexDirection: 'row', alignItems: 'center' },
  detailsToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44 },
  detailsTitle: { color: '#FFE7EA', fontSize: 14, fontWeight: '600', flexShrink: 1 },
  refreshStatus: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  fundingHeading: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  disabled: { opacity: 0.5 },
  hero: { alignSelf: 'stretch', paddingBottom: 12 },
  clockOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  // Center the pill on the figures' cap height within the vertically centered text line.
  balanceBadge: { alignSelf: 'center', transform: [{ translateY: -2 }] },
  balanceButton: {
    flex: 1,
    maxWidth: '69%',
    minWidth: 0,
    minHeight: 44,
    justifyContent: 'center',
  },
  balance: {
    color: '#FFFFFF',
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: -0.4,
    textAlign: 'left',
    includeFontPadding: false,
  },
  balanceLabel: {
    color: '#FFE7EA',
    fontSize: 12,
    marginTop: 4,
  },
  fiat: { color: '#FFFFFF', marginTop: 10 },
  status: {
    color: '#FFE7EA',
    marginTop: 2,
    fontSize: 12,
  },
  bridgeAmount: { maxWidth: '55%' },
  historyNotice: { paddingHorizontal: 16, paddingVertical: 8 },
  menu: { padding: 10 },
  menuText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  funding: { padding: 16, gap: 8 },
  actions: { flexDirection: 'row', gap: 10 },
  action: {
    flex: 1,
    minHeight: 68,
    borderRadius: 34,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactActionRow: { marginTop: 9 },
  compactAction: { minHeight: 62, paddingVertical: 9, borderRadius: 31 },
  lightningAction: { backgroundColor: WalletGradient.xbtWallet[0] },
  receiveAction: { backgroundColor: '#18794E' },
  fundingAction: { backgroundColor: '#3A3A3C' },
  secondary: { minHeight: 54 },
  secondaryTitle: { textTransform: 'uppercase', fontSize: 15 },
  actionTitle: {
    textTransform: 'uppercase',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    color: '#FFFFFF',
  },
  actionSubtitle: {
    textTransform: 'uppercase',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 2,
    color: '#FFFFFF',
  },
  footer: {
    flexShrink: 0,
    paddingTop: 8,
    gap: 6,
  },
  empty: { textAlign: 'center', padding: 28, fontSize: 16 },
  row: {
    minHeight: 48,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    maxWidth: '58%',
  },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  amount: { fontWeight: '700', flexShrink: 1, textAlign: 'right' },
  load: {
    minHeight: 44,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
