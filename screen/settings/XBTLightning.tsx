import CrossChainLightning from '../../components/CrossChainLightning';
import { readBridgeInvoice } from '../../blue_modules/lightning-bridge/invoice';
import { crossChainBridge } from '../../blue_modules/lightning-bridge/runtime';
import { LightningResize, selectedChannelAfterResize } from '../../blue_modules/lightning-resize';
import { authorizeInForeground } from '../../blue_modules/foreground-authorization';
import QRCodeComponent from '../../components/QRCode';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
import { useStorage } from '../../hooks/context/useStorage';
import { LndWallet, LndOverview } from '../../class/wallets/lnd-wallet';
import { lndBalanceBreakdown } from '../../blue_modules/lnd-balance-breakdown';
import Clipboard from '@react-native-clipboard/clipboard';
import { keepLocalCopy, pick, saveDocuments, types } from '@react-native-documents/picker';
import RNFS from 'react-native-fs';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  Keyboard,
  NativeModules,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import SettingsExplanation from '../../components/SettingsExplanation';
import { SettingsFootnote, SettingsListItem, SettingsScrollView, SettingsSection } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';
import { usePaymentAuthorization } from '../../hooks/usePaymentAuthorization';
import { useSecretExport } from '../../hooks/useSecretExport';
import XBTLightningNodeName from '../../components/XBTLightningNodeName';
import XBTLightningNetwork from '../../components/XBTLightningNetwork';
import XBTLightningChannelLimits, { ChannelPaymentLimits, OpeningLimits } from '../../components/XBTLightningChannelLimits';
import XBTLightningChannelFunds from '../../components/XBTLightningChannelFunds';
import XBTLightningInvoice, { LightningReceiveInvoice } from '../../components/XBTLightningInvoice';

import { validLightningChannelOpenSats, validLightningSats, validLightningFeeRate } from '../../blue_modules/lightning-amounts';
import { LndPaymentTracker, LndPaymentOutcome, lndPaymentMessage } from '../../blue_modules/lnd-payment-status';

import { isBolt12Offer, normalizeLightningRequest } from '../../blue_modules/lightning-request';

const bridge = NativeModules.XBTLightningBridge;
// These fixed outcomes contain no wallet amounts. Keep them visible after a
// submission; opaque native results and errors require revealing the balance.
const publicActivityOutcomes = new Set([
  ...(['pending', 'not_found', 'unknown', 'not_submitted'] as const).map(state => lndPaymentMessage({ state })),
  ...['not_synced', 'invalid_invoice', 'invalid_review', 'canceled', 'history_unavailable'].map(reason =>
    lndPaymentMessage({ state: 'not_submitted', reason }),
  ),
  lndPaymentMessage({ state: 'settled', alreadyPaid: true }),
  'Payment settled.',
  'Payment failed. Check channel balance and routing.',
  'Action canceled. Nothing was submitted.',
  'Withdrawal outcome unknown. Check on-chain history before creating another withdrawal.',
  'Channel close was not confirmed. Check channels and on-chain history before retrying.',
  'Resize outcome unknown or not completed. Refresh channels and check the node before creating another resize.',
  'Review ready. No funds have moved.',
]);
type Channel = {
  point: string;
  peer: string;
  peerAlias?: string;
  peerAddress?: string;
  originalPoint?: string;
  active: boolean;
  localSats: string;
  remoteSats?: string;
  sendLimits?: ChannelPaymentLimits;
  receiveLimits?: ChannelPaymentLimits;
  peerFunding?: {
    openingPeerSats?: string;
    complete: boolean;
    changes: { point: string; peerDeltaSats?: string; time?: string }[];
  };
  state: 'active' | 'inactive' | 'pending' | 'closing' | 'forceClosing';
  confirmationsRemaining?: number;
  splice?: LightningResize;
};
type Withdrawal = {
  token: string;
  address: string;
  sats: string;
  feeRate: string;
};
type SavedOffer = {
  id: string;
  offer: string;
  sats: string;
  description: string;
  active: boolean;
  expires: string;
};
type Review = {
  bolt12Token?: string;
  invoice: string;
  hash: string;
  sats: string;
  destination: string;
  feeLimit: string;
};
type PaymentAttempt = {
  hash: string;
  sats?: string;
  outcome: LndPaymentOutcome;
};

function paymentFeedbackTitle(outcome: LndPaymentOutcome): string {
  switch (outcome.state) {
    case 'settled':
      return outcome.alreadyPaid ? 'INVOICE ALREADY PAID' : 'PAYMENT SUCCEEDED';
    case 'failed':
      return 'PAYMENT FAILED';
    case 'pending':
      return 'PAYMENT PENDING';
    case 'unknown':
      return 'PAYMENT STATUS UNKNOWN';
    case 'not_found':
      return 'NO PAYMENT RECORDED';
    case 'not_submitted':
      if (outcome.reason === 'canceled') return 'PAYMENT CANCELED';
      if (outcome.reason === 'history_unavailable') return 'PAYMENT STATUS UNAVAILABLE';
      return outcome.reason === 'invalid_invoice' || outcome.reason === 'invalid_review' ? 'PAYMENT REFUSED' : 'PAYMENT NOT SENT';
  }
}

function summarizeChannels(items: Channel[]) {
  const active = items.filter(channel => channel.state === 'active').length;
  const inactive = items.filter(channel => channel.state === 'inactive').length;
  const pending = items.filter(channel => channel.state === 'pending').length;
  const closing = items.filter(channel => ['closing', 'forceClosing'].includes(channel.state)).length;
  return { open: active + inactive, active, inactive, pending, closing };
}

function channelSummary(items: Channel[]) {
  const counts = summarizeChannels(items);
  return counts.open + ' open · ' + counts.active + ' active · ' + counts.pending + ' pending · ' + counts.closing + ' closing';
}

function channelState(channel: Channel) {
  switch (channel.state) {
    case 'active':
      return 'Active';
    case 'inactive':
      return 'Open · Inactive';
    case 'pending':
      return channel.confirmationsRemaining
        ? 'Pending · ' + channel.confirmationsRemaining + ' confirmation(s) remaining'
        : 'Pending · Waiting for confirmations or peer readiness';
    case 'forceClosing':
      return 'Force closing · Funds awaiting recovery';
    case 'closing':
      return 'Closing · Waiting for settlement';
  }
}

function channelBalances(channel: Channel, hideBalances: boolean) {
  if (hideBalances) return 'Local balance: ••••\nPeer balance: ••••';
  const peer = channel.remoteSats === undefined ? 'Unavailable' : channel.remoteSats + ' sats';
  return 'Local balance: ' + channel.localSats + ' sats\nPeer balance: ' + peer;
}

function peerFundingText(channel: Channel, hideBalances: boolean, details = false) {
  const history = channel.peerFunding;
  if (!history && (Platform.OS !== 'ios' || !['active', 'inactive'].includes(channel.state))) return '';
  if (hideBalances) return '\nPeer contributed: ••••';
  if (!history) return '\nPeer contributed: Unknown';

  let added = BigInt(history.openingPeerSats ?? '0');
  const lines = [];
  for (const change of history.changes) {
    const delta = change.peerDeltaSats === undefined ? undefined : BigInt(change.peerDeltaSats);
    if (delta !== undefined && delta > 0n) added += delta;
    if (details) {
      const when = change.time ? ' · ' + new Date(Number(change.time) * 1000).toLocaleDateString() : '';
      let event = 'peer amount unavailable';
      if (delta === 0n) event = 'peer contributed 0 sats';
      else if (delta !== undefined) event = delta > 0n ? 'peer added ' + delta + ' sats' : 'peer removed ' + -delta + ' sats';
      lines.push('Resize' + when + ' · ' + event);
    }
  }
  const amount = history.complete ? added + ' sats' : added > 0n ? 'at least ' + added + ' sats' : 'Unknown';
  const summary = '\nPeer contributed: ' + amount;
  if (!details) return summary;
  lines.push('Opening · peer funding: ' + (history.openingPeerSats === undefined ? 'Unknown' : history.openingPeerSats + ' sats'));
  if (!history.complete) lines.push('Some funding history is unavailable.');
  return summary + '\nFunding history\n' + lines.join('\n');
}

function selectedChannelDetails(channel: Channel, hideBalances = false) {
  return (
    'Status: ' +
    channelState(channel) +
    '\nPeer name: ' +
    (channel.peerAlias || 'Not announced') +
    '\nPeer public key: ' +
    channel.peer +
    '\nCurrent peer address: ' +
    (channel.peerAddress || 'Unavailable — peer may be disconnected') +
    '\nChannel funding reference: ' +
    channel.point +
    '\n' +
    channelBalances(channel, hideBalances) +
    peerFundingText(channel, hideBalances, true)
  );
}

async function exportBackup(url: string) {
  if (Platform.OS === 'android') {
    const [result] = await saveDocuments({
      sourceUris: [url],
      copy: true,
      mimeType: 'application/octet-stream',
    });
    if (result.error) throw new Error(result.error);
  } else {
    await Share.share({ url });
  }
}

export default function XBTLightning({
  route,
}: {
  route?: { params?: { mode?: 'pay' | 'invoice' | 'send' | 'receive' } };
} = {}) {
  const navigation = useExtendedNavigation();
  const { wallets, saveToDisk } = useStorage();
  const lightningWallet = wallets.find(wallet => wallet.type === LndWallet.type);
  const hideBalances = lightningWallet?.hideBalance === true;
  const privacy = useRef(hideBalances);
  privacy.current = hideBalances;
  const authorizePayment = usePaymentAuthorization();
  const authorizeExport = useSecretExport();
  const mode = route?.params?.mode;
  const tools = !mode;
  const { colors, dark } = useTheme();
  const informationColor = colors.settingsTextColor ?? colors.alternativeTextColor;
  const panelBackground = dark ? colors.cardSectionBackground : colors.hdbackgroundColor;
  const [torActive, setTorActive] = useState(false);
  const [peer, setPeer] = useState('');
  const [peerLoaded, setPeerLoaded] = useState(false);
  const [status, setStatus] = useState('Checking');
  const [message, setMessage] = useState('');
  // Structured overview observed by the latest successful "Node and channel balances" action.
  const [balanceOverview, setBalanceOverview] = useState<LndOverview>();
  const [activityTitle, setActivityTitle] = useState('Activity');
  const [activityError, setActivityError] = useState(false);
  const [copied, setCopied] = useState(false);
  const scrollView = useRef<ScrollView>(null);
  const activityTop = useRef(0);
  const viewport = useRef({ y: 0, height: 0 });
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [amount, setAmount] = useState('');
  const [channelSats, setChannelSats] = useState('100000');
  const [channelFeeRate, setChannelFeeRate] = useState('1');
  const [showChannelLimits, setShowChannelLimits] = useState(false);
  const [openingLimits, setOpeningLimits] = useState<OpeningLimits>({
    minimum: '',
    maximum: '',
  });
  const customOpeningLimits = !!(openingLimits.minimum || openingLimits.maximum);
  const [routingFee, setRoutingFee] = useState('10');
  const [fundingAddress, setFundingAddress] = useState('');
  const [incoming, setIncoming] = useState<LightningReceiveInvoice>();
  const [receiveOffer, setReceiveOffer] = useState(false);
  const [offerDescription, setOfferDescription] = useState('');
  const [offerAmount, setOfferAmount] = useState('');
  const [savedOffers, setSavedOffers] = useState<SavedOffer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<SavedOffer>();
  const [lightningPeer, setLightningPeer] = useState('');
  const [outgoing, setOutgoing] = useState('');
  const [invoiceFocused, setInvoiceFocused] = useState(false);
  const [review, setReview] = useState<Review>();
  const [crossPayment, setCrossPayment] = useState<{ invoice?: string }>();
  const [channels, setChannels] = useState<Channel[]>();
  const [channelError, setChannelError] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<string>();
  const selection = useRef<string | undefined>(undefined);
  selection.current = selectedPoint;
  useEffect(() => {
    if (activityTitle !== 'Selected channel') return;
    const channel = channels?.find(item => item.point === selectedPoint);
    setMessage(channel ? selectedChannelDetails(channel) : 'The selected channel is no longer listed. Select another channel.');
    setActivityError(channelError);
    if (channelError) setMessage('Channel refresh failed. Refresh channels before using these details or actions.');
  }, [channels, selectedPoint, activityTitle, channelError]);
  const selectedChannel = channels?.find(channel => channel.point === selectedPoint);
  const receiveResult = activityTitle === 'Invoice to receive' && !activityError;
  // Native results and errors are opaque strings that can include balances,
  // amounts and fees. Never render or copy them while the wallet is hidden.
  // Peer identity remains useful and can be reconstructed without its balance.
  const activityMessage =
    hideBalances && message && !publicActivityOutcomes.has(message)
      ? activityTitle === 'Selected channel' && selectedChannel && !channelError
        ? selectedChannelDetails(selectedChannel, true)
        : 'Activity details are hidden. Reveal your Lightning balance to view them.'
      : message;
  // Only a fresh, synced, visible and positive amount may look spendable.
  let availableBeforeFee: number | undefined;
  if (activityTitle === 'Node and channel balances' && !activityError && !hideBalances && status === 'Running' && balanceOverview?.synced) {
    try {
      const value = lndBalanceBreakdown(balanceOverview).onchainAvailable;
      if (value > 0) availableBeforeFee = value;
    } catch {
      availableBeforeFee = undefined;
    }
  }
  const channelRequest = useRef<Promise<Channel[]> | undefined>(undefined);
  const channelSnapshot = useRef<Channel[]>([]);
  const [destination, setDestination] = useState('');
  const [withdrawSats, setWithdrawSats] = useState('');
  const [feeRate, setFeeRate] = useState('1');
  const [withdrawal, setWithdrawal] = useState<Withdrawal>();
  const submitted = useRef(new Set<string>());
  const validFeeRate = validLightningFeeRate(feeRate);
  const pending = useRef(false);
  const mounted = useRef(false);
  const [paymentTracker] = useState(
    () =>
      new LndPaymentTracker(cursor => {
        // iPhone exposes wallet pages; Android exposes the same read-only page
        // through its existing invoice bridge.
        return bridge.wallet ? bridge.wallet('payments', cursor) : bridge.invoice('paymentHistory', cursor, '', '');
      }),
  );
  const [paymentAttempt, setPaymentAttempt] = useState<PaymentAttempt>();
  const paymentStatusVisible = useRef(false);
  const visiblePayment = !busy && paymentStatusVisible.current ? paymentAttempt : undefined;
  const feedbackTitle =
    visiblePayment &&
    message === lndPaymentMessage(visiblePayment.outcome) &&
    (visiblePayment.outcome.state !== 'settled' || !activityError)
      ? paymentFeedbackTitle(visiblePayment.outcome)
      : !busy && paymentStatusVisible.current && activityError
        ? 'PAYMENT STATUS UNAVAILABLE'
        : undefined;
  const confirmedPayment =
    visiblePayment && (feedbackTitle === 'PAYMENT SUCCEEDED' || feedbackTitle === 'INVOICE ALREADY PAID') ? visiblePayment : undefined;
  const paymentWarning = ['PAYMENT PENDING', 'PAYMENT STATUS UNKNOWN', 'PAYMENT STATUS UNAVAILABLE'].includes(feedbackTitle ?? '');
  const paymentFailure = ['PAYMENT FAILED', 'PAYMENT REFUSED', 'PAYMENT NOT SENT'].includes(feedbackTitle ?? '');
  const paymentFeedbackColor = confirmedPayment
    ? dark
      ? '#73DFA6'
      : '#147648'
    : paymentFailure
      ? dark
        ? '#FF8D96'
        : '#B42318'
      : paymentWarning
        ? dark
          ? '#FFD166'
          : '#8A5A00'
        : colors.foregroundColor;
  const paymentReceipt =
    confirmedPayment && !hideBalances
      ? [
          confirmedPayment.sats ? 'AMOUNT: ' + Number(confirmedPayment.sats).toLocaleString() + ' SATS' : undefined,
          'PAYMENT REFERENCE:\n' + confirmedPayment.hash,
        ]
          .filter(Boolean)
          .join('\n')
      : '';
  const refreshChannels = useCallback((): Promise<Channel[]> => {
    if (channelRequest.current) return channelRequest.current;
    const request = Promise.resolve()
      .then(() => bridge.manage('channelStatus', '', '', '') as Promise<Channel[]>)
      .then(
        async items => {
          if (lightningWallet instanceof LndWallet) {
            try {
              await lightningWallet.fetchBalance();
              await saveToDisk();
            } catch {
              // A failed balance read never completes a resize.
            }
          }
          if (mounted.current) {
            const previous = channelSnapshot.current;
            channelSnapshot.current = items;
            setChannels(items);
            setSelectedPoint(current => selectedChannelAfterResize(current, previous, items));
            setChannelError(false);
          }
          return items;
        },
        error => {
          if (mounted.current) setChannelError(true);
          throw error;
        },
      )
      .finally(() => {
        channelRequest.current = undefined;
      });
    channelRequest.current = request;
    return request;
  }, [lightningWallet, saveToDisk]);
  const run = async (title: string, action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setActivityTitle(title);
    paymentStatusVisible.current = title === 'Pay invoice' || title === 'Payment status';
    setActivityError(false);
    setCopied(false);
    setMessage('');
    setBalanceOverview(undefined);
    Keyboard.dismiss();
    // Once reached, the activity panel stays pinned while the controls scroll.
    // Reveal it when an action is triggered before it has entered the viewport.
    if (viewport.current.y + viewport.current.height < activityTop.current + 120) {
      scrollView.current?.scrollTo({ y: activityTop.current, animated: true });
    }
    try {
      await action();
      if (mounted.current) setMessage(current => current || 'Completed.');
    } catch (err) {
      if (mounted.current) {
        setActivityError(true);
        setMessage(err instanceof Error ? err.message : 'The Lightning node could not answer.');
      }
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const authorizeAction = async (action: (isCurrent: () => boolean) => Promise<void>, exporting = false): Promise<boolean> => {
    let current = true;
    const isCurrent = () => mounted.current && current && navigation.isFocused();
    const unsubscribe = navigation.addListener('blur', () => {
      current = false;
    });
    try {
      const authorized = await authorizeInForeground(exporting ? authorizeExport : authorizePayment, isCurrent);
      if (!authorized) {
        if (mounted.current) setMessage('Action canceled. Nothing was submitted.');
        return false;
      }
      await action(isCurrent);
      return true;
    } finally {
      unsubscribe();
    }
  };
  const runAuthorized = (title: string, action: () => Promise<void>, exporting = false) =>
    run(title, async () => {
      await authorizeAction(action, exporting);
    });
  const runExport = (title: string, action: () => Promise<void>) => runAuthorized(title, action, true);
  const node = (action: string) =>
    run(action === 'start' ? 'Starting node' : action === 'setup' ? 'Setting up wallet' : 'Node status', async () => {
      try {
        if (action === 'start') setStatus('Starting');
        const next = await bridge.run(action, peer);
        if (mounted.current) {
          setStatus(next);
          setMessage('Node status: ' + next);
        }
      } catch (error) {
        if (action === 'start' && mounted.current) {
          try {
            const current = await bridge.run('status', '');
            if (mounted.current) setStatus(current);
          } catch {
            setStatus('Failed');
          }
        }
        throw error;
      }
    });
  useEffect(() => {
    mounted.current = true;
    let active = true;
    Promise.all([bridge.run('status', ''), bridge.peer()]).then(
      ([value, savedPeer]: [string, string]) => {
        if (active) {
          setPeer(savedPeer);
          setPeerLoaded(true);
          setStatus(value);
        }
      },
      () => {
        if (active) setMessage('Could not read node status or saved peer settings. Reopen this screen to retry.');
      },
    );
    return () => {
      active = false;
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!['Starting', 'Tor connecting', 'Unlocked', 'RPC ready', 'Syncing'].includes(status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const detail = await bridge.run('progress', '');
        if (active) setProgress(detail);
        const next = await bridge.run('status', '');
        if (active) setStatus(next);
      } catch {
        if (active) setProgress('The node has not answered yet. Check the chain peer connection.');
      }
      if (active) timer = setTimeout(refresh, 3000);
    };
    timer = setTimeout(refresh, 3000);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [status]);
  useEffect(() => {
    if (status !== 'Running') return;
    const refresh = () => {
      if (AppState.currentState !== 'background' && AppState.currentState !== 'inactive') {
        refreshChannels().catch(() => {});
      }
    };
    refresh();
    const timer = setInterval(refresh, 15000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [status, refreshChannels]);
  const trackedPaymentHash = paymentAttempt?.hash;
  const trackedPaymentState = paymentAttempt?.outcome.state;
  const trackedPaymentSats = paymentAttempt?.sats;
  useEffect(() => {
    if (!trackedPaymentHash || !trackedPaymentState || !['pending', 'unknown'].includes(trackedPaymentState)) return;
    let active = true;
    let checking = false;
    const hash = trackedPaymentHash;
    const refresh = async () => {
      if (
        !active ||
        checking ||
        pending.current ||
        !paymentStatusVisible.current ||
        ['background', 'inactive'].includes(AppState.currentState)
      )
        return;
      checking = true;
      try {
        const state = await paymentTracker.status(hash);
        if (active && mounted.current && paymentStatusVisible.current && !pending.current) {
          const outcome = { state };
          setPaymentAttempt({ hash, sats: trackedPaymentSats, outcome });
          setMessage(lndPaymentMessage(outcome));
          setActivityError(state === 'unknown');
        }
      } catch {
        // An unavailable read cannot release an unresolved payment's guard.
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(refresh, 5000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [trackedPaymentHash, trackedPaymentState, trackedPaymentSats, paymentTracker]);
  const confirm = (payment: Review) =>
    Alert.alert(
      'Pay invoice?',
      payment.sats + ' sats to ' + payment.destination + '. Maximum routing fee: ' + payment.feeLimit + ' sats.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay',
          onPress: () =>
            runAuthorized('Pay invoice', async () => {
              setReview(undefined);
              setPaymentAttempt({
                hash: payment.hash,
                sats: payment.sats,
                outcome: { state: 'pending' },
              });
              const outcome = await paymentTracker.submit(payment.hash, async () => {
                // Status lookup can finish after authentication or navigation changes.
                if (!mounted.current || ['background', 'inactive'].includes(AppState.currentState)) {
                  throw Object.assign(new Error('Payment canceled before submission.'), { code: 'payment_not_submitted_canceled' });
                }
                if (payment.bolt12Token) return bridge.offers('pay', payment.bolt12Token, '', '');
                if (bridge.bridgePayment && (await crossChainBridge.blocksNormalPayment(payment.hash))) {
                  throw new Error('Cross-chain payment already submitted.');
                }
                return bridge.payInvoice
                  ? bridge.payInvoice(payment.invoice, payment.hash, payment.sats, payment.feeLimit)
                  : bridge.invoice('pay', payment.invoice, payment.hash, payment.sats);
              });
              if (mounted.current) {
                setPaymentAttempt({
                  hash: payment.hash,
                  sats: payment.sats,
                  outcome,
                });
                setMessage(lndPaymentMessage(outcome));
                setActivityError(['unknown', 'not_submitted', 'failed'].includes(outcome.state));
                if (outcome.state === 'settled') setOutgoing('');
              }
            }),
        },
      ],
    );
  const confirmWithdrawal = (item: Withdrawal) =>
    Alert.alert('Withdraw XBT?', item.sats + ' sats to ' + item.address + '. Network fee added at ' + item.feeRate + ' sat/vB.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Withdraw',
        onPress: () =>
          runAuthorized('Withdraw XBT', async () => {
            if (submitted.current.has(item.token)) return;
            submitted.current.add(item.token);
            setWithdrawal(undefined);
            try {
              const txid = await bridge.manage('withdraw', item.token, '', '');
              if (mounted.current) setMessage('Withdrawal broadcast: ' + txid);
            } catch {
              if (mounted.current) setMessage('Withdrawal outcome unknown. Check on-chain history before creating another withdrawal.');
            }
          }),
      },
    ]);
  const confirmClose = (channel: Channel) => {
    const rate = feeRate;
    Alert.alert(
      'Close this channel?',
      'Channel: ' +
        channel.point +
        '\nPeer: ' +
        channel.peer +
        '\n\nReturn this channel’s funds to the Lightning node’s on-chain wallet. Starting fee rate: ' +
        rate +
        ' sat/vB. For channels funded by this node, the negotiated fee rate is capped at ' +
        Number(rate) * 3 +
        ' sat/vB. The peer must be online.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close channel',
          onPress: () =>
            runAuthorized('Close channel', async () => {
              if (selection.current !== channel.point || submitted.current.has(channel.point)) return;
              submitted.current.add(channel.point);
              try {
                const txid = await bridge.manage('close', channel.point, '', rate);
                refreshChannels().catch(() => {});
                if (mounted.current) setMessage('Channel close broadcast: ' + txid + '. Funds become available after confirmation.');
              } catch {
                if (mounted.current) setMessage('Channel close was not confirmed. Check channels and on-chain history before retrying.');
              }
            }),
        },
      ],
    );
  };
  return (
    <SettingsScrollView
      ref={scrollView}
      testID="XBTLightningScreen"
      stickyHeaderIndices={[1]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator
      scrollEventThrottle={16}
      onLayout={event => {
        viewport.current.height = event.nativeEvent.layout.height;
      }}
      onScroll={event => {
        viewport.current.y = event.nativeEvent.contentOffset.y;
      }}
    >
      <SettingsSection>
        {tools && (
          <SettingsExplanation id="lightning.node-peers" title="About This Lightning Node">
            XBT Lightning runs on this phone and connects to public XBT chain peers. Leave the peer blank to use the built-in list, or enter
            your own compact-filter chain peer as host:port. Your home node is optional.
          </SettingsExplanation>
        )}
        {status === 'Stopped' && (
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            style={[
              styles.input,
              {
                color: busy ? informationColor : colors.foregroundColor,
                backgroundColor: panelBackground,
                borderColor: colors.hdborderColor,
              },
            ]}
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
        {['Starting', 'Tor connecting', 'Unlocked', 'RPC ready', 'Syncing'].includes(status) && (
          <SettingsFootnote>
            The node is starting or syncing. Status updates automatically. If this does not advance, the configured chain peer may be
            unreachable.
          </SettingsFootnote>
        )}
        {status === 'Failed' && (
          <SettingsFootnote>
            The Lightning node could not finish starting. Close and reopen RedWallet to retry. Your saved wallet is retained.
          </SettingsFootnote>
        )}
        {!!progress && <SettingsFootnote>{progress}</SettingsFootnote>}
        <SettingsListItem title="Node status" subtitle={busy ? 'Working…' : status} />
        {status === 'Stopped' && <SettingsListItem title="Start XBT node" disabled={busy || !peerLoaded} onPress={() => node('start')} />}
        {(status === 'Needs setup' || status === 'Locked') && (
          <SettingsListItem
            title={status === 'Locked' ? 'Unlock Lightning wallet' : 'Create Lightning wallet'}
            disabled={busy}
            onPress={() => node('setup')}
          />
        )}
        <SettingsListItem testID="LightningRefreshStatus" title="Refresh status" disabled={busy} onPress={() => node('status')} />
      </SettingsSection>
      <View
        testID="LightningActivityPanel"
        onLayout={event => {
          activityTop.current = event.nativeEvent.layout.y;
        }}
        style={[styles.activityWrapper, { backgroundColor: colors.background }]}
      >
        <View
          testID={confirmedPayment ? 'LightningPaymentSuccess' : undefined}
          style={[
            styles.activityPanel,
            {
              backgroundColor: panelBackground,
              borderColor: feedbackTitle ? paymentFeedbackColor : colors.hdborderColor,
            },
          ]}
        >
          {tools && status === 'Running' && (
            <View testID="LightningChannelSummary" style={[styles.channelSummary, { borderBottomColor: colors.hdborderColor }]}>
              <Text style={[styles.activityTitle, { color: colors.alternativeTextColor2 }]}>
                {channels ? 'Channels · ' + summarizeChannels(channels).open + ' open' : 'Channels'}
              </Text>
              <Text accessibilityLiveRegion="polite" style={[styles.activityText, { color: colors.foregroundColor }]}>
                {channels
                  ? summarizeChannels(channels).active +
                    ' active · ' +
                    summarizeChannels(channels).inactive +
                    ' inactive\n' +
                    summarizeChannels(channels).pending +
                    ' pending · ' +
                    summarizeChannels(channels).closing +
                    ' closing'
                  : channelError
                    ? 'Channel count unavailable. Tap Refresh channels to retry.'
                    : 'Checking channels…'}
              </Text>
              {channelError && channels && <Text style={{ color: colors.alternativeTextColor2 }}>Last known counts · Refresh failed</Text>}
            </View>
          )}
          <View style={styles.activityHeader}>
            <Text
              accessibilityRole="header"
              accessibilityLiveRegion="polite"
              style={[
                styles.activityTitle,
                {
                  color: feedbackTitle ? paymentFeedbackColor : colors.alternativeTextColor2,
                },
              ]}
            >
              {feedbackTitle || (activityError ? activityTitle + ' · Error' : activityTitle)}
            </Text>
            {busy && mode !== 'pay' && (
              <ActivityIndicator accessibilityLabel="Lightning operation in progress" color={colors.foregroundColor} />
            )}
            {!!message && !busy && !hideBalances && (!receiveResult || !!incoming) && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={receiveResult ? 'Copy receive request' : 'Copy activity result'}
                style={[styles.copyButton, { backgroundColor: colors.buttonBackgroundColor }]}
                onPress={() => {
                  if (privacy.current || lightningWallet?.hideBalance) return;
                  if (receiveResult && incoming) {
                    Clipboard.setString(incoming.invoice);
                  } else {
                    Clipboard.setString(paymentReceipt ? message + '\n' + paymentReceipt : message);
                  }
                  setCopied(true);
                }}
              >
                <Text style={{ color: colors.foregroundColor }}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            )}
          </View>
          {busy && mode === 'pay' && (
            <ActivityIndicator
              accessibilityLabel="Lightning operation in progress"
              color={colors.foregroundColor}
              style={styles.payActivitySpinner}
            />
          )}
          <ScrollView
            key={activityTitle + activityMessage + (confirmedPayment?.hash ?? '')}
            nestedScrollEnabled
            style={styles.activityBody}
          >
            <Text
              selectable
              accessibilityLiveRegion="polite"
              style={[
                styles.activityText,
                {
                  color: activityError ? colors.alternativeTextColor2 : colors.foregroundColor,
                },
              ]}
            >
              {busy ? 'Working…' : activityMessage || 'Results will appear here.'}
            </Text>
            {availableBeforeFee !== undefined && !busy && (
              <Text testID="LightningAvailableBeforeFee" style={[styles.activityText, { color: colors.successColor }]}>
                {'On-chain available before fee: ' + availableBeforeFee + ' sats'}
              </Text>
            )}
            {availableBeforeFee !== undefined &&
              !busy &&
              balanceOverview &&
              Number(balanceOverview.fundingConfirmed) !== availableBeforeFee && (
                <Text testID="LightningConfirmedTotal" style={[styles.activityText, { color: colors.foregroundColor }]}>
                  {'Confirmed on-chain total (includes reserve): ' + balanceOverview.fundingConfirmed + ' sats'}
                </Text>
              )}
            {!!paymentReceipt && (
              <Text
                testID="LightningPaymentReceipt"
                selectable
                style={[styles.activityText, styles.paymentReceipt, { color: colors.foregroundColor }]}
              >
                {paymentReceipt}
              </Text>
            )}
          </ScrollView>
        </View>
      </View>
      {tools && bridge.nodeName && <XBTLightningNodeName status={status} busy={busy} />}
      {tools && bridge.network && bridge.watchtower && (
        <XBTLightningNetwork status={status} busy={busy} run={run} report={setMessage} onTorChange={setTorActive} />
      )}
      {status === 'Running' && (
        <SettingsSection>
          {tools && (
            <>
              <SettingsListItem
                title="Node and channel balances"
                disabled={busy}
                onPress={() =>
                  run('Node and channel balances', async () => {
                    const result = await bridge.run('details', '');
                    // Same structured overview and reserve calculation as the Funding tab.
                    // Any failure leaves the native details without an available value.
                    let observed: LndOverview | undefined;
                    try {
                      observed = await bridge.wallet?.('overview', '');
                    } catch {
                      observed = undefined;
                    }
                    if (mounted.current) {
                      setBalanceOverview(observed);
                      setMessage(result);
                    }
                  })
                }
              />
            </>
          )}
          {(tools || mode === 'receive') && (
            <>
              <SettingsListItem
                title="Get XBT funding address"
                disabled={busy}
                onPress={() =>
                  run('XBT funding address', async () => {
                    const address = await bridge.run('fund', '');
                    if (mounted.current) {
                      setFundingAddress(address);
                      setMessage(address);
                    }
                  })
                }
              />
              {!!fundingAddress && mode === 'receive' && (
                <View style={styles.fundingQR}>
                  <View pointerEvents="none">
                    <QRCodeComponent value={fundingAddress} size={220} isLogoRendered={false} isMenuAvailable={false} />
                  </View>
                  <Text selectable style={{ color: colors.foregroundColor }}>
                    {fundingAddress}
                  </Text>
                  <SettingsListItem title="Copy address" onPress={() => Clipboard.setString(fundingAddress)} />
                  <SettingsListItem
                    title="Share address"
                    onPress={() =>
                      Share.share({ message: fundingAddress }).catch(() => setMessage('Sharing unavailable. Use Copy address.'))
                    }
                  />
                </View>
              )}
            </>
          )}
          {tools && (
            <>
              <TextInput
                placeholderTextColor={colors.alternativeTextColor2}
                accessibilityLabel="Lightning peer"
                style={[
                  styles.input,
                  {
                    color: busy ? informationColor : colors.foregroundColor,
                    backgroundColor: panelBackground,
                    borderColor: colors.hdborderColor,
                  },
                ]}
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
                  run('Connect Lightning peer', async () => {
                    if (!torActive && /\.onion(?::[0-9]+)?$/i.test(lightningPeer.trim())) {
                      throw new Error(
                        bridge.network
                          ? 'Select Tor for Lightning, then restart RedWallet to connect to an onion peer.'
                          : 'Tor-only Lightning peers are not supported by this build. Use a reachable IP or DNS address for the same XBT network.',
                      );
                    }
                    const result = await bridge.invoice('connect', lightningPeer.trim(), '', '');
                    if (mounted.current) setMessage(result);
                  })
                }
              />
              <SettingsFootnote>CHANNEL AMOUNT (SATS) · MAX 100,000,000 (1 XBT)</SettingsFootnote>
              <TextInput
                accessibilityLabel="New channel sats"
                style={[
                  styles.input,
                  {
                    color: busy ? informationColor : colors.foregroundColor,
                    borderColor: colors.hdborderColor,
                  },
                ]}
                keyboardType="number-pad"
                value={channelSats}
                editable={!busy}
                onChangeText={setChannelSats}
              />
              <SettingsFootnote>Funding Fee Rate (sat/vB)</SettingsFootnote>
              <TextInput
                accessibilityLabel="New channel fee rate"
                style={[
                  styles.input,
                  {
                    color: busy ? informationColor : colors.foregroundColor,
                    borderColor: colors.hdborderColor,
                  },
                ]}
                keyboardType="number-pad"
                value={channelFeeRate}
                editable={!busy}
                onChangeText={setChannelFeeRate}
              />
              {Platform.OS === 'ios' && (
                <SettingsListItem
                  title="Receive limits for new channel"
                  subtitle={customOpeningLimits ? 'Custom limits' : 'Node minimum · No RedWallet maximum'}
                  disabled={busy}
                  onPress={() => setShowChannelLimits(true)}
                />
              )}
              <SettingsListItem
                title="Open private channel"
                disabled={busy || !lightningPeer || !validLightningChannelOpenSats(channelSats) || !validLightningFeeRate(channelFeeRate)}
                onPress={() => {
                  const key = lightningPeer.trim().split('@')[0];
                  const sats = channelSats,
                    rate = channelFeeRate;
                  let submittedOpen = false;
                  Alert.alert(
                    'Open a private channel?',
                    'Commit ' +
                      sats +
                      ' sats at ' +
                      rate +
                      ' sat/vB to ' +
                      key +
                      (customOpeningLimits
                        ? '. Minimum incoming part: ' +
                          (openingLimits.minimum ? openingLimits.minimum + ' sats' : 'node default') +
                          '. Maximum incoming in flight: ' +
                          (openingLimits.maximum ? openingLimits.maximum + ' sats' : 'no RedWallet cap')
                        : '') +
                      '. The peer starts with 0 sats. RedWallet sets no amount cap on later peer-funded top-ups. Wait for the opening transaction to confirm.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Open channel',
                        onPress: () =>
                          runAuthorized('Open private channel', async () => {
                            if (submittedOpen) return;
                            submittedOpen = true;
                            const point = customOpeningLimits
                              ? await bridge.manage(
                                  'openWithReceiveLimits',
                                  JSON.stringify({
                                    peer: key,
                                    minimum: openingLimits.minimum ? Number(openingLimits.minimum) : undefined,
                                    maximum: openingLimits.maximum ? Number(openingLimits.maximum) : undefined,
                                  }),
                                  sats,
                                  rate,
                                )
                              : await bridge.invoice('open', key, rate, sats);
                            if (mounted.current) setOpeningLimits({ minimum: '', maximum: '' });
                            refreshChannels().catch(() => {});
                            if (mounted.current)
                              setMessage(
                                'Funding transaction: ' +
                                  point +
                                  '\nChannel requested. Wait for confirmations. Opening again creates another channel.',
                              );
                          }),
                      },
                    ],
                  );
                }}
              />
            </>
          )}
          {(tools || mode === 'invoice') && (
            <>
              {bridge.offers && (
                <>
                  <SettingsListItem
                    title={receiveOffer ? 'Use single-use invoice' : 'Use reusable BOLT12 offer'}
                    disabled={busy}
                    onPress={() => {
                      setReceiveOffer(value => !value);
                      setIncoming(undefined);
                      setSelectedOffer(undefined);
                    }}
                  />
                  {receiveOffer && (
                    <>
                      <TextInput
                        accessibilityLabel="Offer description"
                        placeholder="What is this offer for?"
                        placeholderTextColor={colors.alternativeTextColor2}
                        style={[
                          styles.input,
                          {
                            color: colors.foregroundColor,
                            borderColor: colors.hdborderColor,
                          },
                        ]}
                        value={offerDescription}
                        onChangeText={setOfferDescription}
                        maxLength={256}
                        editable={!busy}
                      />
                      <SettingsFootnote>
                        BOLT12 offers are reusable. Leave the amount empty to let the payer choose. Keep RedWallet open to receive.
                      </SettingsFootnote>
                      <SettingsListItem
                        title="Saved offers"
                        disabled={busy}
                        onPress={() =>
                          run('Saved offers', async () => {
                            const result = await bridge.offers('list', '', '', '');
                            if (mounted.current) {
                              setSavedOffers(result);
                              setMessage(result.length ? 'Select an offer below.' : 'No saved offers.');
                            }
                          })
                        }
                      />
                      {savedOffers.map(item => (
                        <SettingsListItem
                          key={item.id}
                          title={item.description + (item.active ? '' : ' · Disabled')}
                          disabled={busy}
                          onPress={() => {
                            setSelectedOffer(item);
                            setIncoming({
                              invoice: item.offer,
                              sats: item.sats,
                              kind: 'offer',
                            });
                          }}
                        />
                      ))}
                    </>
                  )}
                </>
              )}
              <TextInput
                placeholderTextColor={colors.alternativeTextColor2}
                style={[
                  styles.input,
                  {
                    color: busy ? informationColor : colors.foregroundColor,
                    backgroundColor: panelBackground,
                    borderColor: colors.hdborderColor,
                  },
                ]}
                accessibilityLabel="Sats to receive"
                placeholder="Sats to receive"
                keyboardType="number-pad"
                value={amount}
                onChangeText={setAmount}
              />
              <SettingsListItem
                title={receiveOffer ? 'Create reusable offer' : 'Create invoice'}
                disabled={
                  busy ||
                  (receiveOffer ? !offerDescription.trim() || (!!amount && !validLightningSats(amount)) : !validLightningSats(amount))
                }
                onPress={() =>
                  run('Invoice to receive', async () => {
                    setIncoming(undefined);
                    setSelectedOffer(undefined);
                    const requestedSats = amount;
                    if (receiveOffer) {
                      const item = await bridge.offers('create', offerDescription.trim(), amount || '0', '');
                      if (!item.offer?.trim()) throw new Error('The node returned an empty offer.');
                      if (mounted.current) {
                        setSelectedOffer(item);
                        setIncoming({
                          invoice: item.offer,
                          sats: item.sats,
                          kind: 'offer',
                        });
                        setMessage('Reusable offer ready. Keep RedWallet open to receive.');
                      }
                      return;
                    }
                    const invoice = await bridge.invoice('receive', '', '', requestedSats);
                    if (!invoice?.trim()) throw new Error('The node returned an empty invoice.');
                    if (mounted.current) {
                      setIncoming({ invoice, sats: requestedSats });
                      setMessage('Invoice ready to receive ' + requestedSats + ' sats. QR code below.');
                    }
                  })
                }
              />
              {selectedOffer && receiveOffer && (
                <SettingsListItem
                  title={selectedOffer.active ? 'Disable offer' : 'Enable offer'}
                  disabled={busy}
                  onPress={() =>
                    run('Offer status', async () => {
                      const item = selectedOffer;
                      await bridge.offers(item.active ? 'disable' : 'enable', item.id, '', '');
                      if (mounted.current) {
                        const next = { ...item, active: !item.active };
                        setSelectedOffer(next);
                        setSavedOffers(items => items.map(old => (old.id === next.id ? next : old)));
                        setMessage(
                          next.active ? 'Offer enabled.' : 'Offer disabled. Existing invoices may still be paid until they expire.',
                        );
                      }
                    })
                  }
                />
              )}
              {incoming && <XBTLightningInvoice key={incoming.invoice} {...incoming} />}
            </>
          )}
          {(tools || mode === 'pay') && (
            <>
              {bridge.bridgePayment && (
                <SettingsListItem title="Cross-chain payment history" disabled={busy} onPress={() => setCrossPayment({})} />
              )}
              {crossPayment && (
                <CrossChainLightning
                  key={crossPayment.invoice ?? 'history'}
                  invoice={crossPayment.invoice}
                  feeLimit={routingFee}
                  hideHistoryAmounts={hideBalances}
                  onClose={() => setCrossPayment(undefined)}
                  canSubmit={() => mounted.current && navigation.isFocused()}
                  authorize={action => authorizeAction(action)}
                />
              )}

              <SettingsListItem
                title="Scan invoice QR"
                disabled={busy}
                onPress={() => {
                  Keyboard.dismiss();
                  navigation.navigate('ScanQRCode', {
                    showFileImportButton: false,
                    onBarScanned: (data: string) => {
                      if (!mounted.current) return;
                      let invoice: string;
                      try {
                        invoice = normalizeLightningRequest(data, !!bridge.offers);
                      } catch {
                        Alert.alert('Not a Lightning request', 'Scan an XBT Lightning invoice or a supported BOLT12 offer.');
                        return;
                      }
                      setReview(undefined);
                      setPaymentAttempt(undefined);
                      paymentStatusVisible.current = false;
                      setOutgoing(invoice.toLowerCase());
                      setActivityTitle('Invoice scanned');
                      setActivityError(false);
                      setMessage('Invoice scanned. Tap Review invoice to check the amount before paying.');
                    },
                  });
                }}
              />
              <TextInput
                placeholderTextColor={colors.alternativeTextColor2}
                style={[
                  styles.input,
                  styles.payInvoiceInput,
                  !busy && (invoiceFocused ? styles.invoiceGlowFocused : styles.invoiceGlow),
                  {
                    color: busy ? informationColor : colors.foregroundColor,
                    backgroundColor: panelBackground,
                    borderColor: !busy && invoiceFocused ? colors.primary : colors.hdborderColor,
                  },
                ]}
                accessibilityLabel="Invoice to pay"
                placeholder={bridge.offers ? 'Paste a Lightning invoice or BOLT12 offer' : 'Paste a Lightning invoice'}
                autoCapitalize="none"
                autoCorrect={false}
                onFocus={() => setInvoiceFocused(true)}
                onBlur={() => setInvoiceFocused(false)}
                value={outgoing}
                onChangeText={value => {
                  setReview(undefined);
                  setPaymentAttempt(undefined);
                  paymentStatusVisible.current = false;
                  setOutgoing(value);
                }}
                editable={!busy}
              />

              {bridge.offers && (
                <>
                  <SettingsListItem
                    title="Resume saved offer payment"
                    disabled={busy}
                    onPress={() =>
                      run('Saved offer payment', async () => {
                        const saved = await bridge.offers('pending', '', '', '');
                        if (!mounted.current) return;
                        setReview(undefined);
                        if (!saved) {
                          setMessage('No saved offer payment.');
                          return;
                        }
                        setOutgoing(saved.offer);
                        setOfferAmount(saved.requestedSats === '0' ? '' : saved.requestedSats);
                        setPaymentAttempt({
                          hash: saved.hash,
                          sats: saved.sats,
                          outcome: { state: 'unknown' },
                        });
                        setMessage('Saved invoice restored. Check payment status or review this same invoice.');
                      })
                    }
                  />
                  {isBolt12Offer(outgoing) && (
                    <>
                      <TextInput
                        accessibilityLabel="Offer payment sats"
                        placeholder="Sats (required for an open amount)"
                        placeholderTextColor={colors.alternativeTextColor2}
                        style={[
                          styles.input,
                          {
                            color: colors.foregroundColor,
                            borderColor: colors.hdborderColor,
                          },
                        ]}
                        keyboardType="number-pad"
                        value={offerAmount}
                        editable={!busy}
                        onChangeText={value => {
                          setOfferAmount(value);
                          setReview(undefined);
                        }}
                      />
                      <SettingsFootnote>
                        Review requests an invoice without paying. BOLT12 needs a routing fee limit of at least 1 sat.
                      </SettingsFootnote>
                      <SettingsListItem
                        title="Start new offer payment"
                        disabled={busy}
                        onPress={() =>
                          Alert.alert(
                            'Request another invoice?',
                            'This starts a separate payment. A settled previous payment will not be reversed. Unresolved payments block this action.',
                            [
                              { text: 'Cancel', style: 'cancel' },
                              {
                                text: 'Start new',
                                onPress: () =>
                                  run('New offer payment', async () => {
                                    await bridge.offers('reset', '', '', '');
                                    if (mounted.current) {
                                      setReview(undefined);
                                      setPaymentAttempt(undefined);
                                      setMessage('Ready to review a new offer payment.');
                                    }
                                  }),
                              },
                            ],
                          )
                        }
                      />
                    </>
                  )}
                </>
              )}

              {bridge.payInvoice && (
                <>
                  <SettingsFootnote>Maximum Routing Fee (sats)</SettingsFootnote>
                  <TextInput
                    accessibilityLabel="Maximum routing fee sats"
                    style={[
                      styles.input,
                      {
                        color: busy ? informationColor : colors.foregroundColor,
                        borderColor: colors.hdborderColor,
                      },
                    ]}
                    keyboardType="number-pad"
                    value={routingFee}
                    editable={!busy}
                    onChangeText={value => {
                      setRoutingFee(value);
                      setReview(undefined);
                    }}
                  />
                </>
              )}
              <SettingsListItem
                title={isBolt12Offer(outgoing) ? 'Review offer' : 'Review invoice'}
                disabled={
                  busy ||
                  !outgoing.trim() ||
                  !validLightningSats(routingFee, !isBolt12Offer(outgoing)) ||
                  (isBolt12Offer(outgoing) && !!offerAmount && !validLightningSats(offerAmount))
                }
                onPress={() =>
                  run('Review invoice', async () => {
                    let invoice = outgoing.trim();
                    let decoded;
                    if (isBolt12Offer(invoice)) {
                      if (!bridge.offers) throw new Error('BOLT12 is not available in this Lightning engine.');
                      decoded = await bridge.offers('review', normalizeLightningRequest(invoice, true), offerAmount || '0', routingFee);
                    } else {
                      if (bridge.bridgePayment && !invoice.startsWith('lnbcrt')) {
                        const parsed = readBridgeInvoice(invoice);
                        invoice = parsed.invoice;
                        if (parsed.chain === 'SHA256') {
                          setReview(undefined);
                          setCrossPayment({ invoice: parsed.invoice });
                          setMessage('Choose a Lightning processor before requesting a quote.');
                          return;
                        }
                      }
                      decoded = await bridge.invoice('decode', invoice, '', '');
                    }
                    if (!mounted.current) return;
                    if (bridge.bridgePayment && (await crossChainBridge.blocksNormalPayment(decoded.hash))) {
                      throw new Error('This cross-chain payment is pending, uncertain or already paid. Check cross-chain history.');
                    }
                    try {
                      const state = await paymentTracker.status(decoded.hash);
                      if (!mounted.current) return;
                      if (state === 'settled' || state === 'pending' || state === 'unknown') {
                        const outcome: LndPaymentOutcome = {
                          state,
                          alreadyPaid: state === 'settled',
                        };
                        setReview(undefined);
                        setPaymentAttempt({
                          hash: decoded.hash,
                          sats: decoded.sats,
                          outcome,
                        });
                        paymentStatusVisible.current = true;
                        setMessage(lndPaymentMessage(outcome));
                      } else {
                        setReview({
                          ...decoded,
                          invoice: decoded.invoice ?? invoice,
                          feeLimit: routingFee,
                        });
                        setMessage(decoded.sats + ' sats to ' + decoded.destination + '. Use Pay below to confirm.');
                      }
                    } catch {
                      if (mounted.current) {
                        setReview(undefined);
                        setPaymentAttempt({
                          hash: decoded.hash,
                          sats: decoded.sats,
                          outcome: { state: 'unknown' },
                        });
                        paymentStatusVisible.current = true;
                        setMessage(
                          lndPaymentMessage({
                            state: 'not_submitted',
                            reason: 'history_unavailable',
                          }),
                        );
                        setActivityError(true);
                      }
                    }
                  })
                }
              />
              {paymentAttempt && (
                <SettingsListItem
                  title="Check payment status"
                  disabled={busy}
                  onPress={() =>
                    run('Payment status', async () => {
                      const state = await paymentTracker.status(paymentAttempt.hash);
                      if (mounted.current) {
                        const outcome = {
                          state,
                          alreadyPaid: state === 'settled' ? paymentAttempt.outcome.alreadyPaid : undefined,
                        };
                        setPaymentAttempt({ ...paymentAttempt, outcome });
                        setMessage(lndPaymentMessage(outcome));
                        setActivityError(state === 'unknown');
                      }
                    })
                  }
                />
              )}
              {review && <SettingsListItem title={'Pay ' + review.sats + ' sats'} disabled={busy} onPress={() => confirm(review)} />}
            </>
          )}
          {tools && (
            <>
              <SettingsListItem
                title="Recent payments"
                disabled={busy}
                onPress={() =>
                  run('Recent payments', async () => {
                    const history = await bridge.run('history', '');
                    if (mounted.current) setMessage(history);
                  })
                }
              />
              <SettingsListItem
                title="Export static channel backup"
                disabled={busy}
                onPress={() =>
                  runExport('Export channel backup', async () => {
                    const url = await bridge.run('backup', '');
                    if (mounted.current) await exportBackup(url);
                  })
                }
              />
            </>
          )}
        </SettingsSection>
      )}
      {status === 'Running' && (tools || mode === 'send') && (
        <SettingsSection>
          <SettingsExplanation id="lightning.channel-management" title="About Channel Management">
            Manage channels and withdraw the Lightning node’s on-chain balance. Closing a channel requires its peer online and a
            confirmation before withdrawing the returned funds. Withdrawals currently support SegWit and Taproot addresses beginning with
            bc1.
          </SettingsExplanation>
          <Text style={[styles.fieldLabel, { color: informationColor }]}>Fee rate (sat/vB)</Text>
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            accessibilityLabel="On-chain fee rate"
            style={[
              styles.input,
              {
                color: busy ? informationColor : colors.foregroundColor,
                backgroundColor: panelBackground,
                borderColor: colors.hdborderColor,
              },
            ]}
            value={feeRate}
            keyboardType="number-pad"
            editable={!busy}
            onChangeText={value => {
              setFeeRate(value);
              setWithdrawal(undefined);
            }}
          />
          {tools && (
            <>
              <SettingsListItem
                title="Refresh channels"
                disabled={busy}
                onPress={() =>
                  run('Refresh channels', async () => {
                    const items = await refreshChannels();
                    if (mounted.current)
                      setMessage(items.length ? channelSummary(items) + '. Details below.' : 'No open or pending channels.');
                  })
                }
              />
              {Platform.OS === 'ios' && (
                <SettingsListItem title="Channel limits" disabled={busy} onPress={() => setShowChannelLimits(true)} />
              )}
              {showChannelLimits && (
                <XBTLightningChannelLimits
                  channel={selectedChannel}
                  refreshFailed={channelError}
                  hidden={hideBalances}
                  opening={openingLimits}
                  onClose={() => setShowChannelLimits(false)}
                  onApply={value => {
                    setOpeningLimits(value);
                    setShowChannelLimits(false);
                  }}
                />
              )}
              <SettingsExplanation id="lightning.channel-selection" title="How To Select A Channel">
                Tap a channel to select it and show its peer identity above. Actions apply only to the selected channel. Inactive channels
                remain listed; pending channels are still opening. Peer balance is the other node’s share of this channel. Reserves and
                pending payments can reduce how much it can send to you. Peer contributed counts deposits at opening and in completed
                resizes. Tap a channel for its funding history.
              </SettingsExplanation>
              {(channels ?? []).map(channel => (
                <View key={channel.point}>
                  <SettingsListItem
                    testID={'SelectChannel-' + channel.point}
                    title={
                      (selectedPoint === channel.point ? '✓ ' : '') +
                      channelState(channel) +
                      (channel.peerAlias ? ' · ' + channel.peerAlias : '')
                    }
                    disabled={busy}
                    onPress={() => {
                      setSelectedPoint(channel.point);
                      setActivityTitle('Selected channel');
                      setActivityError(false);
                      setCopied(false);
                      setMessage(selectedChannelDetails(channel));
                      Keyboard.dismiss();
                      scrollView.current?.scrollTo({
                        y: activityTop.current,
                        animated: true,
                      });
                    }}
                    subtitle={channelBalances(channel, hideBalances) + peerFundingText(channel, hideBalances)}
                    subtitleNumberOfLines={0}
                  />
                  {selectedPoint === channel.point && bridge.splice && ['active', 'inactive'].includes(channel.state) && (
                    <XBTLightningChannelFunds
                      point={channel.point}
                      active={channel.active && !channelError}
                      hideBalances={hideBalances}
                      splice={channel.splice}
                      busy={busy}
                      run={run}
                      runAuthorized={runAuthorized}
                      report={setMessage}
                      onUpdated={() => {
                        refreshChannels().catch(() => {});
                      }}
                    />
                  )}
                  {selectedPoint === channel.point && ['active', 'inactive'].includes(channel.state) && (
                    <SettingsListItem
                      title={hideBalances ? 'Close channel' : 'Close channel · ' + channel.localSats + ' local sats'}
                      disabled={busy || channelError || !validFeeRate || !channel.active || submitted.current.has(channel.point)}
                      onPress={() => confirmClose(channel)}
                    />
                  )}
                </View>
              ))}
            </>
          )}
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            accessibilityLabel="Withdrawal address"
            placeholder="XBT address (bc1…)"
            style={[
              styles.input,
              {
                color: busy ? informationColor : colors.foregroundColor,
                backgroundColor: panelBackground,
                borderColor: colors.hdborderColor,
              },
            ]}
            value={destination}
            autoCapitalize="none"
            autoCorrect={false}
            editable={!busy}
            onChangeText={value => {
              setDestination(value);
              setWithdrawal(undefined);
            }}
          />
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            accessibilityLabel="Withdrawal sats"
            placeholder="Amount in sats"
            style={[
              styles.input,
              {
                color: busy ? informationColor : colors.foregroundColor,
                backgroundColor: panelBackground,
                borderColor: colors.hdborderColor,
              },
            ]}
            value={withdrawSats}
            keyboardType="number-pad"
            editable={!busy}
            onChangeText={value => {
              setWithdrawSats(value);
              setWithdrawal(undefined);
            }}
          />
          <SettingsListItem
            title="Review withdrawal"
            disabled={busy || !validFeeRate || !destination.trim() || !validLightningSats(withdrawSats)}
            onPress={() =>
              run('Review withdrawal', async () => {
                const item = await bridge.manage('withdrawReview', destination.trim(), withdrawSats, feeRate);
                if (mounted.current) {
                  setWithdrawal(item);
                  setMessage(item.sats + ' sats to ' + item.address + ' at ' + item.feeRate + ' sat/vB. Use Withdraw below to confirm.');
                }
              })
            }
          />
          {withdrawal && (
            <SettingsListItem
              title={'Withdraw ' + withdrawal.sats + ' sats'}
              disabled={busy}
              onPress={() => confirmWithdrawal(withdrawal)}
            />
          )}
          {tools && (
            <>
              <SettingsListItem
                title="On-chain history"
                disabled={busy}
                onPress={() =>
                  run('On-chain history', async () => {
                    const history = await bridge.manage('history', '', '', '');
                    if (mounted.current) setMessage(history);
                  })
                }
              />
            </>
          )}
        </SettingsSection>
      )}
      {tools && ['Needs setup', 'Running'].includes(status) && (
        <SettingsSection>
          <SettingsExplanation id="lightning.recovery" title="About Lightning Recovery">
            Portable Lightning recovery saves the wallet seed and static channel backup together. Keep the passphrase separately. Export
            again after channel changes.
          </SettingsExplanation>
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            style={[
              styles.input,
              {
                color: busy ? informationColor : colors.foregroundColor,
                backgroundColor: panelBackground,
                borderColor: colors.hdborderColor,
              },
            ]}
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
                  'Restore to this device?',
                  'Take the original node offline first. Static channel recovery can close channels and return funds on-chain.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Choose recovery file',
                      onPress: () =>
                        run('Restore Lightning wallet', async () => {
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
                runExport('Export recovery file', async () => {
                  const password = phrase;
                  setPhrase('');
                  const url = await bridge.recovery('export', password, '');
                  try {
                    if (mounted.current) await exportBackup(url);
                  } finally {
                    await RNFS.unlink(decodeURIComponent(url.replace(/^file:\/\//, ''))).catch(() => {});
                  }
                })
              }
            />
          )}
        </SettingsSection>
      )}
    </SettingsScrollView>
  );
}

const styles = StyleSheet.create({
  paymentReceipt: { marginTop: 12 },
  activityWrapper: { paddingHorizontal: 16, paddingVertical: 8 },
  activityPanel: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  channelSummary: { borderBottomWidth: 1, paddingBottom: 6, marginBottom: 6 },
  activityHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  activityTitle: { flex: 1, fontSize: 14, fontWeight: '600' },
  copyButton: {
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  payActivitySpinner: { alignSelf: 'center' },
  activityBody: { maxHeight: 112 },
  activityText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    lineHeight: 19,
    paddingVertical: 4,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  fundingQR: { alignItems: 'center', padding: 16, gap: 16 },
  payInvoiceInput: { minHeight: 50, paddingVertical: 15 },
  invoiceGlow: {
    boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 6, spreadDistance: 1, color: 'rgba(244, 54, 104, 0.28)' }],
  },
  invoiceGlowFocused: {
    boxShadow: [{ offsetX: 0, offsetY: 0, blurRadius: 9, spreadDistance: 1, color: 'rgba(244, 54, 104, 0.46)' }],
  },
  input: {
    marginHorizontal: 12,
    marginVertical: 6,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
  },
});
