import QRCodeComponent from '../../components/QRCode';
import { useExtendedNavigation } from '../../hooks/useExtendedNavigation';
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
import { SettingsFootnote, SettingsListItem, SettingsScrollView, SettingsSection } from '../../components/SettingsSection';
import { useTheme } from '../../components/themes';
import XBTLightningNetwork from '../../components/XBTLightningNetwork';
import XBTLightningChannelFunds from '../../components/XBTLightningChannelFunds';
import XBTLightningInvoice, { LightningReceiveInvoice } from '../../components/XBTLightningInvoice';

import { validLightningChannelOpenSats, validLightningSats, validLightningFeeRate } from '../../blue_modules/lightning-amounts';

const bridge = NativeModules.XBTLightningBridge;
type Channel = {
  point: string;
  peer: string;
  peerAlias?: string;
  peerAddress?: string;
  active: boolean;
  localSats: string;
  state: 'active' | 'inactive' | 'pending' | 'closing' | 'forceClosing';
  confirmationsRemaining?: number;
  splice?: {
    status: string;
    progress: string;
    txid: string;
    confirmations: string;
    lockDepth: string;
  };
};
type Withdrawal = {
  token: string;
  address: string;
  sats: string;
  feeRate: string;
};
type Review = {
  invoice: string;
  hash: string;
  sats: string;
  destination: string;
  feeLimit: string;
};

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

function selectedChannelDetails(channel: Channel) {
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
    '\nLocal balance: ' +
    channel.localSats +
    ' sats'
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
  const mode = route?.params?.mode;
  const tools = !mode;
  const { colors, dark } = useTheme();
  const panelBackground = dark ? colors.cardSectionBackground : colors.hdbackgroundColor;
  const [torActive, setTorActive] = useState(false);
  const [peer, setPeer] = useState('');
  const [peerLoaded, setPeerLoaded] = useState(false);
  const [status, setStatus] = useState('Checking');
  const [message, setMessage] = useState('');
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
  const [routingFee, setRoutingFee] = useState('10');
  const [fundingAddress, setFundingAddress] = useState('');
  const [incoming, setIncoming] = useState<LightningReceiveInvoice>();
  const [lightningPeer, setLightningPeer] = useState('');
  const [outgoing, setOutgoing] = useState('');
  const [review, setReview] = useState<Review>();
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
  const channelRequest = useRef<Promise<Channel[]> | undefined>(undefined);
  const [destination, setDestination] = useState('');
  const [withdrawSats, setWithdrawSats] = useState('');
  const [feeRate, setFeeRate] = useState('1');
  const [withdrawal, setWithdrawal] = useState<Withdrawal>();
  const submitted = useRef(new Set<string>());
  const validFeeRate = validLightningFeeRate(feeRate);
  const pending = useRef(false);
  const mounted = useRef(false);
  const pendingPayment = useRef<string | undefined>(undefined);
  const refreshChannels = useCallback((): Promise<Channel[]> => {
    if (channelRequest.current) return channelRequest.current;
    const request = Promise.resolve()
      .then(() => bridge.manage('channelStatus', '', '', '') as Promise<Channel[]>)
      .then(
        items => {
          if (mounted.current) {
            setChannels(items);
            setSelectedPoint(current => (items.some(item => item.point === current) ? current : undefined));
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
  }, []);
  const run = async (title: string, action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setActivityTitle(title);
    setActivityError(false);
    setCopied(false);
    setMessage('');
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
  const confirm = (payment: Review) =>
    Alert.alert(
      'Pay invoice?',
      payment.sats + ' sats to ' + payment.destination + '. Maximum routing fee: ' + payment.feeLimit + ' sats.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Pay',
          onPress: () =>
            run('Pay invoice', async () => {
              if (pendingPayment.current === payment.hash) return;
              pendingPayment.current = payment.hash;
              setReview(undefined);
              try {
                const settled = bridge.payInvoice
                  ? await bridge.payInvoice(payment.invoice, payment.hash, payment.sats, payment.feeLimit)
                  : await bridge.invoice('pay', payment.invoice, payment.hash, payment.sats);
                if (!settled) pendingPayment.current = undefined;
                if (mounted.current) setMessage(settled ? 'Payment settled.' : 'Payment failed. Check channel balance and routing.');
              } catch {
                if (mounted.current) setMessage('Payment outcome unknown. Check the node payment history before trying again.');
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
          run('Withdraw XBT', async () => {
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
            run('Close channel', async () => {
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
          <SettingsFootnote style={{ color: colors.foregroundColor }}>
            XBT Lightning runs on this phone and connects to public XBT chain peers. Leave the peer blank to use the built-in list, or enter
            your own compact-filter chain peer as host:port. Your home node is optional.
          </SettingsFootnote>
        )}
        {status === 'Stopped' && (
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            style={[
              styles.input,
              {
                color: colors.foregroundColor,
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
          <SettingsFootnote style={{ color: colors.foregroundColor }}>
            The node is starting or syncing. Status updates automatically. If this does not advance, the configured chain peer may be
            unreachable.
          </SettingsFootnote>
        )}
        {status === 'Failed' && (
          <SettingsFootnote style={{ color: colors.foregroundColor }}>
            The Lightning node could not finish starting. Close and reopen RedWallet to retry. Your saved wallet is retained.
          </SettingsFootnote>
        )}
        {!!progress && <SettingsFootnote style={{ color: colors.foregroundColor }}>{progress}</SettingsFootnote>}
        <SettingsListItem title="Node status" subtitle={busy ? 'Working…' : status} />
        {status === 'Stopped' && <SettingsListItem title="Start XBT node" disabled={busy || !peerLoaded} onPress={() => node('start')} />}
        {(status === 'Needs setup' || status === 'Locked') && (
          <SettingsListItem
            title={status === 'Locked' ? 'Unlock Lightning wallet' : 'Create Lightning wallet'}
            disabled={busy}
            onPress={() => node('setup')}
          />
        )}
        <SettingsListItem title="Refresh status" disabled={busy} onPress={() => node('status')} />
      </SettingsSection>
      <View
        testID="LightningActivityPanel"
        onLayout={event => {
          activityTop.current = event.nativeEvent.layout.y;
        }}
        style={[styles.activityWrapper, { backgroundColor: colors.background }]}
      >
        <View
          style={[
            styles.activityPanel,
            {
              backgroundColor: panelBackground,
              borderColor: colors.hdborderColor,
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
            <Text accessibilityRole="header" style={[styles.activityTitle, { color: colors.alternativeTextColor2 }]}>
              {activityError ? activityTitle + ' · Error' : activityTitle}
            </Text>
            {busy && <ActivityIndicator accessibilityLabel="Lightning operation in progress" color={colors.foregroundColor} />}
            {!!message && !busy && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy activity result"
                style={[styles.copyButton, { backgroundColor: colors.buttonBackgroundColor }]}
                onPress={() => {
                  Clipboard.setString(message);
                  setCopied(true);
                }}
              >
                <Text style={{ color: colors.foregroundColor }}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
            )}
          </View>
          <ScrollView key={activityTitle + message} nestedScrollEnabled style={styles.activityBody}>
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
              {busy ? 'Working…' : message || 'Results will appear here.'}
            </Text>
          </ScrollView>
        </View>
      </View>
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
                    if (mounted.current) setMessage(result);
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
                    color: colors.foregroundColor,
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
              <SettingsFootnote>CHANNEL AMOUNT (SATS) · MAX 10,000,000</SettingsFootnote>
              <TextInput
                accessibilityLabel="New channel sats"
                style={[styles.input, { color: colors.foregroundColor, borderColor: colors.hdborderColor }]}
                keyboardType="number-pad"
                value={channelSats}
                editable={!busy}
                onChangeText={setChannelSats}
              />
              <SettingsFootnote>FUNDING FEE RATE (SAT/VB)</SettingsFootnote>
              <TextInput
                accessibilityLabel="New channel fee rate"
                style={[styles.input, { color: colors.foregroundColor, borderColor: colors.hdborderColor }]}
                keyboardType="number-pad"
                value={channelFeeRate}
                editable={!busy}
                onChangeText={setChannelFeeRate}
              />
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
                      '. Tapping Open channel creates a new channel. After opening, wait for the funding transaction to confirm.',
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Open channel',
                        onPress: () =>
                          run('Open private channel', async () => {
                            if (submittedOpen) return;
                            submittedOpen = true;
                            const point = await bridge.invoice('open', key, rate, sats);
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
              <TextInput
                placeholderTextColor={colors.alternativeTextColor2}
                style={[
                  styles.input,
                  {
                    color: colors.foregroundColor,
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
                title="Create invoice"
                disabled={busy || !validLightningSats(amount)}
                onPress={() =>
                  run('Invoice to receive', async () => {
                    const requestedSats = amount;
                    const invoice = await bridge.invoice('receive', '', '', requestedSats);
                    if (mounted.current) {
                      setIncoming({ invoice, sats: requestedSats });
                      setMessage('Invoice ready to receive ' + requestedSats + ' sats. QR code below.');
                    }
                  })
                }
              />
              {incoming && <XBTLightningInvoice key={incoming.invoice} {...incoming} />}
            </>
          )}
          {(tools || mode === 'pay') && (
            <>
              <SettingsListItem
                title="Scan invoice QR"
                disabled={busy}
                onPress={() => {
                  Keyboard.dismiss();
                  navigation.navigate('ScanQRCode', {
                    showFileImportButton: false,
                    onBarScanned: (data: string) => {
                      if (!mounted.current) return;
                      const invoice = data.trim().replace(/^lightning:/i, '');
                      if (
                        invoice.length > 8192 ||
                        !/^lnbc[0-9]*[munp]?1[02-9ac-hj-np-z]+$/i.test(invoice) ||
                        (invoice !== invoice.toLowerCase() && invoice !== invoice.toUpperCase())
                      ) {
                        Alert.alert('Not a Lightning invoice', 'Scan a Lightning invoice QR code to pay.');
                        return;
                      }
                      setReview(undefined);
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
                  {
                    color: colors.foregroundColor,
                    backgroundColor: panelBackground,
                    borderColor: colors.hdborderColor,
                  },
                ]}
                accessibilityLabel="Invoice to pay"
                placeholder="Paste a Lightning invoice"
                autoCapitalize="none"
                autoCorrect={false}
                value={outgoing}
                onChangeText={value => {
                  setReview(undefined);
                  setOutgoing(value);
                }}
                editable={!busy}
              />
              {bridge.payInvoice && (
                <>
                  <SettingsFootnote>MAXIMUM ROUTING FEE (SATS)</SettingsFootnote>
                  <TextInput
                    accessibilityLabel="Maximum routing fee sats"
                    style={[styles.input, { color: colors.foregroundColor, borderColor: colors.hdborderColor }]}
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
                title="Review invoice"
                disabled={busy || !outgoing.trim() || !validLightningSats(routingFee, true)}
                onPress={() =>
                  run('Review invoice', async () => {
                    const invoice = outgoing.trim();
                    const decoded = await bridge.invoice('decode', invoice, '', '');
                    if (mounted.current) {
                      setReview({ ...decoded, invoice, feeLimit: routingFee });
                      setMessage(decoded.sats + ' sats to ' + decoded.destination + '. Use Pay below to confirm.');
                    }
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
                  run('Export channel backup', async () => {
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
          <SettingsFootnote style={{ color: colors.foregroundColor }}>
            Manage channels and withdraw the Lightning node’s on-chain balance. Closing a channel requires its peer online and a
            confirmation before withdrawing the returned funds. Withdrawals currently support SegWit and Taproot addresses beginning with
            bc1.
          </SettingsFootnote>
          <Text style={[styles.fieldLabel, { color: colors.foregroundColor }]}>Fee rate (sat/vB)</Text>
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            accessibilityLabel="On-chain fee rate"
            style={[
              styles.input,
              {
                color: colors.foregroundColor,
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
              <SettingsFootnote style={{ color: colors.foregroundColor }}>
                Tap a channel to select it and show its peer identity above. Actions apply only to the selected channel. Inactive channels
                remain listed; pending channels are still opening.
              </SettingsFootnote>
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
                    subtitle={'Local balance: ' + channel.localSats + ' sats\nPeer: ' + channel.peer + '\nFunding: ' + channel.point}
                  />
                  {selectedPoint === channel.point && bridge.splice && ['active', 'inactive'].includes(channel.state) && (
                    <XBTLightningChannelFunds
                      point={channel.point}
                      active={channel.active && !channelError}
                      splice={channel.splice}
                      busy={busy}
                      run={run}
                      report={setMessage}
                      onUpdated={() => {
                        refreshChannels().catch(() => {});
                      }}
                    />
                  )}
                  {selectedPoint === channel.point && ['active', 'inactive'].includes(channel.state) && (
                    <SettingsListItem
                      title={'Close channel · ' + channel.localSats + ' local sats'}
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
                color: colors.foregroundColor,
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
                color: colors.foregroundColor,
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
          <SettingsFootnote style={{ color: colors.foregroundColor }}>
            Portable Lightning recovery saves the wallet seed and static channel backup together. Keep the passphrase separately. Export
            again after channel changes.
          </SettingsFootnote>
          <TextInput
            placeholderTextColor={colors.alternativeTextColor2}
            style={[
              styles.input,
              {
                color: colors.foregroundColor,
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
                run('Export recovery file', async () => {
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
