import React, { useCallback, useLayoutEffect, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  NativeModules,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Clipboard from '@react-native-clipboard/clipboard';
import { LndActivity, LndActivityPage, LndWallet } from '../../class/wallets/lnd-wallet';
import WalletGradient from '../../class/wallet-gradient';
import LndConnectionBadge from '../../components/LndConnectionBadge';
import { useTheme } from '../../components/themes';
import XbtFiatEstimate from '../../components/XbtFiatEstimate';
import { useStorage } from '../../hooks/context/useStorage';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useSettings } from '../../hooks/context/useSettings';
import { formatLndAmount, nextLndDisplayUnit } from '../../blue_modules/lnd-display-amount';

const bridge = NativeModules.XBTLightningBridge;
type Pages = Partial<Record<'payments' | 'invoices' | 'funding', LndActivityPage>>;
const merge = (old: LndActivity[], next: LndActivity[]) => [
  ...new Map([...old, ...next].map(row => [row.direction + row.id, row])).values(),
];

export default function LndWalletHome({ wallet }: { wallet: LndWallet }) {
  const { colors } = useTheme();
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
  const [tab, setTab] = useState<'transactions' | 'funding'>('transactions');
  const [pages, setPages] = useState<Pages>({});
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState('Checking Lightning connection…');
  const [, redraw] = useState(0);
  const pending = useRef(false);
  const reload = useRef(false);
  const focused = useRef(false);
  const generation = useRef(0);
  const open = useCallback((mode?: 'pay' | 'invoice' | 'send' | 'receive') => navigation.navigate('XBTLightning', { mode }), [navigation]);
  useLayoutEffect(() => {
    navigation.setOptions({
      title: wallet.getLabel(),
      headerTransparent: false,
      headerStyle: { backgroundColor: WalletGradient.xbtWallet[0] },
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
    async (more = false) => {
      if (!focused.current || ['background', 'inactive'].includes(AppState.currentState)) return;
      if (pending.current) {
        if (!more) reload.current = true;
        return;
      }
      pending.current = true;
      const requestGeneration = generation.current;
      setRefreshing(true);
      try {
        await wallet.fetchBalance();
        if (!focused.current || generation.current !== requestGeneration) return;
        redraw(value => value + 1);
        if (wallet.status !== 'Running') {
          setMessage('Node: ' + wallet.status + '. Open wallet settings to start or unlock it.');
          return;
        }
        const kinds: ('funding' | 'payments' | 'invoices')[] = tab === 'funding' ? ['funding'] : ['payments', 'invoices'];
        const updates: Pages = {};
        for (const kind of kinds) {
          const previous = pages[kind];
          if (more && previous && !previous.more) continue;
          const page: LndActivityPage = await bridge.wallet(kind, more ? (previous?.next ?? '0') : '0');
          if (more && previous && page.more && page.next === previous.next) throw new Error('History cursor did not advance.');
          updates[kind] = {
            ...page,
            ...(previous && !more && previous.rows.length > 100 ? { next: previous.next, more: previous.more } : {}),
            rows: merge(previous?.rows ?? [], page.rows),
          };
        }
        if (!focused.current || generation.current !== requestGeneration) return;
        setPages(old => ({ ...old, ...updates }));
        if (updates.payments && updates.invoices) wallet.activity = [...updates.payments.rows, ...updates.invoices.rows];
        setMessage(
          wallet.connection() === 'connected' ? 'Connected · Updates while this screen is open' : 'Waiting for sync or Lightning peers',
        );
        await saveToDisk();
      } catch (error) {
        if (focused.current) setMessage('Refresh failed. Showing last known data. Pull down to retry.');
      } finally {
        pending.current = false;
        if (focused.current) {
          setRefreshing(false);
          redraw(value => value + 1);
        }
        if (reload.current && focused.current) {
          reload.current = false;
          refreshRef.current();
        }
      }
    },
    [wallet, tab, pages, saveToDisk],
  );
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    refreshRef.current();
  }, [tab]);
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      generation.current += 1;
      refreshRef.current();
      const timer = setInterval(() => refreshRef.current(), 15000);
      const subscription = AppState.addEventListener('change', state => {
        wallet.observedAt = 0;
        redraw(value => value + 1);
        if (state === 'active') refreshRef.current();
      });
      return () => {
        focused.current = false;
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
  const rows = (tab === 'funding' ? (pages.funding?.rows ?? []) : [...(pages.payments?.rows ?? []), ...(pages.invoices?.rows ?? [])]).sort(
    (a, b) => b.timestamp - a.timestamp || a.id.localeCompare(b.id),
  );
  const isCanceled = (row: LndActivity) => tab === 'transactions' && row.state === 'canceled' && row.confirmations === undefined;
  const canceled = rows.filter(isCanceled);
  const latestCanceled = canceled[0];
  const visibleRows = rows.filter(row => !isCanceled(row) || canceledExpanded || row === latestCanceled);
  const hasMore = tab === 'funding' ? pages.funding?.more : pages.payments?.more || pages.invoices?.more;
  const cancelling = useRef(new Set<string>());
  const cancelInvoice = async (row: LndActivity) => {
    if (cancelling.current.has(row.id)) return;
    cancelling.current.add(row.id);
    try {
      const cancelled = await bridge.invoice('cancel', '', row.id, '');
      if (cancelled !== true) throw new Error('Cancellation was not confirmed.');
      // Only mark canceled after LND acknowledges; never infer success from dismissal.
      setPages(previous => {
        const invoices = previous.invoices;
        return invoices
          ? {
              ...previous,
              invoices: {
                ...invoices,
                rows: invoices.rows.map(item => (item.id === row.id ? { ...item, state: 'canceled' } : item)),
              },
            }
          : previous;
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
    const text =
      exactAmount(row.sats) +
      ' · ' +
      row.state +
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
                        void cancelInvoice(row);
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
        secondary ? styles.fundingAction : mode === 'invoice' ? styles.receiveAction : styles.lightningAction,
        !ready && styles.disabled,
        secondary && styles.secondary,
      ]}
    >
      <Text style={[styles.actionTitle, secondary && styles.secondaryTitle]}>{mode === 'invoice' ? 'RECEIVE' : title}</Text>
      {mode === 'invoice' && <Text style={styles.actionSubtitle}>Create invoice</Text>}
    </Pressable>
  );
  const renderActivity = (item: LndActivity) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={(item.direction === 'sent' ? 'Sent' : 'Received') + ' · ' + item.state}
      onPress={() => details(item)}
      style={[styles.row, { borderBottomColor: colors.lightBorder }]}
    >
      <View style={styles.rowBody}>
        <Text style={[styles.rowTitle, { color: isCanceled(item) ? colors.alternativeTextColor : colors.foregroundColor }]}>
          {item.direction === 'sent'
            ? '↗ Payment'
            : item.state === 'unpaid'
              ? 'Invoice · Awaiting payment'
              : item.confirmations === undefined && item.state !== 'settled'
                ? 'Invoice · ' + item.state
                : '↙ Received'}
        </Text>
        <Text style={{ color: colors.alternativeTextColor }}>
          {item.state}
          {item.confirmations !== undefined ? ' · ' + item.confirmations + ' confirmations' : ''} ·{' '}
          {item.timestamp ? new Date(item.timestamp * 1000).toLocaleString() : 'Time unavailable'}
        </Text>
        {!wallet.hideBalance && !!item.memo && (
          <Text numberOfLines={1} style={{ color: colors.alternativeTextColor }}>
            {item.memo}
          </Text>
        )}
      </View>
      <Text
        style={[
          styles.amount,
          {
            color: isCanceled(item)
              ? colors.alternativeTextColor
              : item.direction === 'received' && ['settled', 'confirmed'].includes(item.state)
                ? colors.successColor
                : colors.foregroundColor,
          },
        ]}
      >
        {wallet.hideBalance ? '••••' : (isCanceled(item) ? '' : item.direction === 'sent' ? '−' : '+') + formatAmount(item.sats)}
      </Text>
    </Pressable>
  );
  return (
    <View testID="LndWalletHome" style={[styles.root, { backgroundColor: colors.background }]}>
      <View
        style={[
          styles.hero,
          {
            backgroundColor: WalletGradient.xbtWallet[0],
            paddingLeft: 16 + insets.left,
            paddingRight: 16 + insets.right,
          },
        ]}
      >
        <LinearGradient colors={WalletGradient.xbtWallet} style={StyleSheet.absoluteFill} pointerEvents="none" />
        <View style={styles.headerLine}>
          <Text numberOfLines={1} style={styles.label}>
            {wallet.getLabel()}
          </Text>
          <LndConnectionBadge wallet={wallet} />
        </View>
        <Pressable
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
        <Text style={styles.balanceLabel}>Total balance · funding and channels</Text>
        {!!overview && !wallet.hideBalance && (
          <Text style={styles.status}>
            Lightning: {formatAmount(overview.lightningLocal)} · Funding: {formatAmount(overview.fundingTotal)}
          </Text>
        )}
        {!wallet.hideBalance && <XbtFiatEstimate satoshis={wallet.getBalance()} style={styles.fiat} />}
        <Text accessibilityLiveRegion="polite" style={styles.status}>
          {message}
        </Text>
        <Text style={styles.status}>{overview ? overview.activeChannels + ' active channel(s)' : 'Node balance not yet available'}</Text>
        <View pointerEvents="none" style={[styles.sectionCurve, { backgroundColor: colors.background }]} />
      </View>
      <View style={[styles.tabs, { borderBottomColor: colors.lightBorder }]}>
        {(['transactions', 'funding'] as const).map(value => (
          <Pressable
            key={value}
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === value }}
            onPress={() => setTab(value)}
            style={[
              styles.tab,
              value === 'funding' && styles.fundingTab,
              tab === value && styles.selectedTab,
              tab === value && {
                borderBottomColor: colors.alternativeTextColor2,
              },
            ]}
          >
            <Text
              style={[
                styles.tabTitle,
                value === 'funding' && styles.fundingTabTitle,
                {
                  color: tab === value ? colors.foregroundColor : colors.alternativeTextColor,
                },
              ]}
            >
              {value === 'transactions' ? 'Transactions' : 'Funding'}
            </Text>
          </Pressable>
        ))}
      </View>
      {tab === 'funding' && (
        <Text style={[styles.fundingHeading, { color: colors.foregroundColor }]}>On-chain deposits and withdrawals</Text>
      )}
      <FlatList
        style={styles.history}
        data={visibleRows}
        contentInsetAdjustmentBehavior="never"
        keyExtractor={row => row.direction + row.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => refresh()} />}
        contentContainerStyle={{ paddingBottom: 170 + insets.bottom }}
        ListHeaderComponent={
          <>
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
            {refreshing
              ? 'Loading…'
              : tab === 'transactions'
                ? 'Lightning payments and invoices will appear here.'
                : 'On-chain funding transactions will appear here.'}
          </Text>
        }
        renderItem={({ item }) =>
          item === latestCanceled ? (
            <View>
              <View style={styles.stack}>
                <View
                  pointerEvents="none"
                  style={[styles.stackLayer, styles.stackBack, { backgroundColor: colors.background, borderColor: colors.lightBorder }]}
                />
                <View
                  pointerEvents="none"
                  style={[styles.stackLayer, styles.stackMiddle, { backgroundColor: colors.background, borderColor: colors.lightBorder }]}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={'Canceled invoices · ' + canceled.length}
                  accessibilityState={{ expanded: canceledExpanded }}
                  onPress={() => setCanceledExpanded(value => !value)}
                  style={[styles.stackFront, { backgroundColor: colors.background, borderColor: colors.lightBorder }]}
                >
                  <Text style={[styles.rowTitle, { color: colors.alternativeTextColor }]}>Canceled invoices · {canceled.length}</Text>
                  <Text style={{ color: colors.alternativeTextColor }}>
                    Latest: {wallet.hideBalance ? '••••' : formatAmount(item.sats)} ·{' '}
                    {item.timestamp ? new Date(item.timestamp * 1000).toLocaleString() : 'Time unavailable'}
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
        style={[
          styles.footer,
          {
            backgroundColor: colors.background,
            paddingBottom: Math.max(insets.bottom, 16),
          },
        ]}
      >
        {!ready && (
          <Pressable accessibilityRole="button" onPress={() => open()}>
            <Text style={{ color: colors.foregroundColor }}>Open node settings · {wallet.status}</Text>
          </Pressable>
        )}
        <View style={styles.actions}>
          {tab === 'funding' ? action('Receive on-chain', 'receive', true) : action('Receive (create invoice)', 'invoice')}
          {tab === 'funding' ? action('Send on-chain', 'send', true) : action('Pay (invoice)', 'pay')}
        </View>
        {refreshing && <ActivityIndicator color={colors.foregroundColor} />}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  stack: { marginHorizontal: 16, marginVertical: 12, paddingBottom: 8 },
  stackLayer: { position: 'absolute', borderWidth: 1, borderRadius: 14, height: 40 },
  stackBack: { bottom: 0, left: 12, right: 12 },
  stackMiddle: { bottom: 4, left: 6, right: 6 },
  stackFront: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  stackHint: { fontSize: 11, fontWeight: '600', marginTop: 4 },
  history: { flex: 1, minHeight: 0 },
  fundingHeading: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  disabled: { opacity: 0.5 },
  selectedTab: { borderBottomWidth: 3 },
  hero: { alignSelf: 'stretch', paddingTop: 24, paddingBottom: 28 },
  sectionCurve: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: -1,
    height: 13,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
  },
  headerLine: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  label: { flex: 1, minWidth: 0, color: '#FFE7EA', fontSize: 20 },
  balance: { color: '#FFFFFF', fontSize: 36, fontWeight: '700', marginTop: 12 },
  balanceLabel: { textTransform: 'uppercase', color: '#FFE7EA', fontSize: 12, marginTop: 4 },
  fiat: { color: '#FFFFFF', marginTop: 10 },
  status: { textTransform: 'uppercase', color: '#FFE7EA', marginTop: 10, fontSize: 12 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', paddingVertical: 18, paddingHorizontal: 16 },
  fundingTab: { flex: 0, minWidth: 76, alignItems: 'center', paddingHorizontal: 12 },
  fundingTabTitle: { fontSize: 12, fontWeight: '600' },
  tabTitle: { fontSize: 24, fontWeight: '700' },
  menu: { padding: 10 },
  menuText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },
  funding: { padding: 16, gap: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 10 },
  action: {
    flex: 1,
    minHeight: 68,
    borderRadius: 34,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lightningAction: { backgroundColor: WalletGradient.xbtWallet[0] },
  receiveAction: { backgroundColor: '#18794E' },
  fundingAction: { backgroundColor: '#3A3A3C' },
  secondary: { minHeight: 54 },
  secondaryTitle: { textTransform: 'uppercase', fontSize: 15 },
  actionTitle: { fontSize: 20, fontWeight: '700', textAlign: 'center', color: '#FFFFFF' },
  actionSubtitle: { textTransform: 'uppercase', fontSize: 12, textAlign: 'center', marginTop: 2, color: '#FFFFFF' },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    gap: 6,
  },
  empty: { textAlign: 'center', padding: 28, fontSize: 16 },
  row: {
    padding: 16,
    borderBottomWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowBody: { flex: 1, gap: 4 },
  rowTitle: { fontSize: 16, fontWeight: '600' },
  amount: { fontWeight: '700', flexShrink: 1 },
  load: { padding: 20, alignItems: 'center' },
});
