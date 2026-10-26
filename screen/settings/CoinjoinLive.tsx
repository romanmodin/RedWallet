import { roundAttention } from '../../class/xbt/kilojoin/attention';
import { poolCountdown, roundTiming, participationElapsed } from '../../class/xbt/kilojoin/timing';
import { activePool } from '../../class/xbt/kilojoin/active-pool';
import { Journal } from '../../class/xbt/kilojoin/round';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SettingsScrollView, SettingsFootnote } from '../../components/SettingsSection';
import Button from '../../components/Button';
import { useTheme } from '../../components/themes';
import { useStorage } from '../../hooks/context/useStorage';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { ClientView, MixingClient, recoverWalletRounds, confirmRecoveredRound } from '../../class/xbt/kilojoin/client';
import { MixingWallet } from '../../class/xbt/kilojoin/wallet-adapter';
import { KilojoinRelay } from '../../class/xbt/kilojoin/relay';
import { LIVE_JOIN_ENABLED, parsePool, Terms, outputCount } from '../../class/xbt/kilojoin/protocol';
import { NostrEvent } from '../../class/xbt/kilojoin/crypto';
import { change, feeShare } from '../../class/xbt/kilojoin/transaction';
import { Utxo } from '../../class/wallets/types';
import { coinjoinIssue, coinjoinProgress } from '../../class/xbt/kilojoin/presentation';

/** Experimental live route; joining requires the entry acknowledgment. */
export default function CoinjoinLive({ experimentalAcknowledged = false }: { experimentalAcknowledged?: boolean }) {
  const { colors } = useTheme(),
    { wallets } = useStorage();
  const choices = wallets.filter((w): w is MixingWallet => w instanceof XbtSegwitBech32Wallet || w instanceof XbtTaprootWallet);
  const [clock, setClock] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const updateClock = () => setClock(Math.floor(Date.now() / 1000));
    const timer = setInterval(updateClock, 1000);
    const foreground = AppState.addEventListener('change', state => {
      if (state === 'active') updateClock();
    });
    return () => {
      clearInterval(timer);
      foreground.remove();
    };
  }, []);
  const [active, setActive] = useState(() => activePool.snapshot());
  const [wallet, setWallet] = useState<MixingWallet | undefined>(() => activePool.snapshot()?.wallet);
  const [pools, setPools] = useState<Record<string, { terms: Readonly<Terms>; event: NostrEvent }>>({});
  const [searchState, setSearchState] = useState<'idle' | 'connecting' | 'searching' | 'ready' | 'failed'>('idle');
  const [poolId, setPoolId] = useState(''),
    [coins, setCoins] = useState<Utxo[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [password, setPassword] = useState(''),
    [maxFee, setMaxFee] = useState('1000');
  const [recovered, setRecovered] = useState<Journal[]>([]);
  const [view, setView] = useState<ClientView | undefined>(() => activePool.snapshot()?.view),
    [error, setError] = useState(''),
    [localBusy, setBusy] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const busy = localBusy || !!active?.busy;
  const client = useRef<MixingClient | undefined>(activePool.snapshot()?.client),
    discovery = useRef<KilojoinRelay | undefined>(undefined),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const detach = activePool.subscribe(next => {
      setActive(next);
      setView(next?.view);
      client.current = next?.client;
      if (next) setWallet(next.wallet);
    });
    return () => {
      detach();
      mounted.current = false;
      discovery.current?.close();
      // Back detaches only this view. Explicit Stop remains the sole cancellation action.
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (activePool.snapshot()?.client) await activePool.perform(action);
      else await action();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : 'Action failed');
    } finally {
      if (mounted.current) setBusy(false);
    }
  };
  const refreshPools = async () => {
    if (!LIVE_JOIN_ENABLED) throw new Error('Live CoinJoin is not enabled');
    discovery.current?.close();
    setPools({});
    setPoolId('');
    setSearchState('connecting');
    const relay = new KilojoinRelay(
      async event => {
        try {
          const terms = parsePool(event, Math.floor(Date.now() / 1000));
          if (mounted.current && discovery.current === relay)
            setPools(old => (old[terms.id]?.event.created_at > event.created_at ? old : { ...old, [terms.id]: { terms, event } }));
        } catch {
          // A newer closed/expired announcement withdraws a previously listed
          // pool, but another publisher cannot remove it.
          if (mounted.current && discovery.current === relay)
            setPools(old =>
              Object.fromEntries(
                Object.entries(old).filter(
                  ([, p]) =>
                    !(
                      p.event.pubkey === event.pubkey &&
                      p.event.created_at <= event.created_at &&
                      event.tags.some(tag => tag[0] === 'd' && tag[1] === p.terms.id)
                    ),
                ),
              ),
            );
        }
      },
      () => {
        if (mounted.current && discovery.current === relay) setSearchState('failed');
      },
    );
    discovery.current = relay;
    try {
      await relay.connect();
      if (!mounted.current || discovery.current !== relay) return;
      setSearchState('searching');
      await relay.discoverPools(Math.floor(Date.now() / 1000) - 2100);
      if (mounted.current && discovery.current === relay) setSearchState('ready');
    } catch (e) {
      relay.close();
      if (mounted.current && discovery.current === relay) {
        setSearchState('failed');
        throw e;
      }
    }
  };
  const chooseWallet = async (chosen: MixingWallet) => {
    setWallet(chosen);
    setSelected([]);
    setCoins([]);
    setRecovered(await recoverWalletRounds(chosen));
    await chosen.fetchUtxo();
    if (mounted.current) setCoins(chosen.getUtxo());
  };
  const visiblePools = Object.values(pools).filter(
    p => p.terms.timeout > Math.floor(Date.now() / 1000) && (!wallet || p.terms.script === wallet.segwitType),
  );
  const pool = visiblePools.find(p => p.terms.id === poolId),
    total = coins.filter(c => selected.includes(`${c.txid}:${c.vout}`)).reduce((n, c) => n + c.value, 0);
  const remainder =
    pool && selected.length
      ? change(total, pool.terms.denomination, pool.terms.fee_rate, selected.length, pool.terms.script, outputCount(pool.terms))
      : null;
  const estimate =
    pool && selected.length
      ? feeShare(pool.terms.fee_rate, remainder !== 0, selected.length, pool.terms.script, outputCount(pool.terms))
      : 0;
  const start = async () => {
    if (!pool || !wallet) throw new Error('Select a wallet and pool');
    const created = await activePool.start(wallet, onUpdate =>
      MixingClient.join({
        experimentalAcknowledged,
        poolEvent: pool.event,
        wallet,
        selected,
        maxFee: Number(maxFee),
        password,
        onUpdate,
      }),
    );
    setPassword('');
    discovery.current?.close();
    if (!mounted.current) return;
    client.current = created;
    setView(created.view());
  };
  const text = { color: colors.foregroundColor },
    card = [styles.card, { backgroundColor: colors.inputBackgroundColor }];
  const pick = (label: string, checked: boolean, onPress: () => void, key: string) => (
    <Pressable key={key} disabled={busy} accessibilityRole="radio" accessibilityState={{ checked }} onPress={onPress} style={styles.choice}>
      <Text style={text}>
        {checked ? '● ' : '○ '}
        {label}
      </Text>
    </Pressable>
  );
  const session = view?.session,
    journal = view?.journal;
  const progress = session && journal ? coinjoinProgress(session, journal) : undefined;
  const timing = session && journal ? roundTiming(session, journal) : undefined;
  const attention = view ? roundAttention(view, clock) : undefined;
  const displayedError = error || view?.error;
  const issue = displayedError ? coinjoinIssue(displayedError) : undefined;
  const signatureCount = session ? Object.keys(session.signatures).length : 0;
  const inputCount = session?.seats.reduce((n, s) => n + s.coins.length, 0) ?? 0;
  return (
    <SettingsScrollView testID="CoinjoinLiveScreen">
      <View style={styles.content}>
        <Text style={styles.badge}>Experimental · Kilojoin</Text>
        <Text style={[styles.title, text]}>CoinJoin</Text>
        <SettingsFootnote>
          The relay can see your IP address. Your configured backend can see address queries. CoinJoin does not guarantee anonymity.
        </SettingsFootnote>
        <SettingsFootnote>Change is labeled and frozen after confirmation to avoid recombining it with the mixed output.</SettingsFootnote>
        {!!attention && (
          <View
            style={[card, styles.attention]}
            testID="CoinjoinActionRequired"
            accessibilityRole="alert"
            accessibilityLiveRegion="assertive"
          >
            <Text style={[text, styles.attentionTitle]}>{attention.title}</Text>
            <Text style={text}>{attention.detail}</Text>
          </View>
        )}
        {!!issue && (
          <View>
            <Text testID="CoinjoinIssueCategory" style={styles.error}>
              {issue.category}
            </Text>
            <Text accessibilityRole="alert" style={styles.error}>
              {displayedError}
            </Text>
            <SettingsFootnote>{issue.detail}</SettingsFootnote>
          </View>
        )}
        {!view && active?.busy ? (
          <SettingsFootnote>Joining pool… You can return to this attempt from the CoinJoin entry.</SettingsFootnote>
        ) : !view ? (
          <>
            <View style={card}>
              <Text style={text}>Wallet</Text>
              {choices.map(w => pick(w.getLabel(), wallet === w, () => run(() => chooseWallet(w)), w.getID()))}
              {!choices.length && <SettingsFootnote>A local XBT SegWit or Taproot wallet is required.</SettingsFootnote>}
            </View>
            {recovered
              .filter(j => j.phase === 'uncertain')
              .map(j => (
                <View key={j.poolId} style={card}>
                  <Text style={text}>Previous signed round · coins remain reserved</Text>
                  <Text selectable style={text}>
                    {j.reviewedId}
                  </Text>
                  <SettingsFootnote>Recovered outputs will remain frozen for review after confirmation.</SettingsFootnote>
                  <Button
                    title="Check previous round confirmation"
                    disabled={busy}
                    onPress={() =>
                      run(async () => {
                        if (!wallet || !(await confirmRecoveredRound(wallet, j.poolId)))
                          throw new Error('Previous round is not confirmed yet');
                        setRecovered(await recoverWalletRounds(wallet));
                        await wallet.fetchUtxo();
                        setCoins(wallet.getUtxo());
                      })
                    }
                  />
                </View>
              ))}
            <Button
              testID="CoinjoinFindPools"
              title={searchState === 'connecting' || searchState === 'searching' ? 'Searching for pools…' : 'Find pools'}
              disabled={busy}
              onPress={() => run(refreshPools)}
            />
            <Text testID="CoinjoinPoolSearchStatus" accessibilityLiveRegion="polite" style={text}>
              {searchState === 'idle' && 'Find open Kilojoin v3 and v4 pools on relay.kilombino.com.'}
              {searchState === 'connecting' && 'Connecting to relay.kilombino.com…'}
              {searchState === 'searching' && 'Connected. Checking open pools…'}
              {searchState === 'failed' && 'Pool search failed or disconnected. Tap Find pools to retry.'}
              {searchState === 'ready' &&
                (visiblePools.length
                  ? `${visiblePools.length} compatible open pool${visiblePools.length === 1 ? '' : 's'} found. Listening for updates.`
                  : 'Connected. No compatible open pools right now. A Kilowallet participant must create one; you can search again.')}
            </Text>
            <SettingsFootnote>
              Pools may close earlier by vote. The announced deadline is not a guaranteed completion time.
            </SettingsFootnote>
            <View style={card}>
              {visiblePools.map(p =>
                pick(
                  `${outputCount(p.terms) > 1 ? outputCount(p.terms) + ' × ' : ''}${p.terms.denomination.toLocaleString()} sats · ${p.terms.peers}/${p.terms.max_peers} · ${p.terms.fee_rate} sats/vB${p.terms.private ? ' · Private' : ''}\nAnnounced deadline: ${new Date(p.terms.timeout * 1000).toLocaleString()} · ${poolCountdown(p.terms.timeout, clock)}`,
                  poolId === p.terms.id,
                  () => {
                    setPoolId(p.terms.id);
                    setSelected([]);
                  },
                  p.terms.id,
                ),
              )}
            </View>
            {!!pool?.terms.private && (
              <TextInput
                accessibilityLabel="Pool password"
                secureTextEntry
                value={password}
                onChangeText={setPassword}
                style={[styles.input, text]}
              />
            )}
            {!!pool && (
              <View style={card}>
                <Text style={text}>Choose confirmed coins · up to {pool.terms.max_inputs}</Text>
                <Text
                  style={text}
                  accessibilityLabel="Coin selection legend: filled circle means selected; empty circle means not selected."
                >
                  ● Selected · ○ Not selected
                </Text>
                <Text style={text}>These circles show selection only, not whether a coin has been mixed or reserved.</Text>
                {coins.map(c => {
                  const id = `${c.txid}:${c.vout}`;
                  return pick(
                    `${c.value.toLocaleString()} sats · ${c.txid.slice(0, 8)}…:${c.vout}`,
                    selected.includes(id),
                    () =>
                      setSelected(old =>
                        old.includes(id) ? old.filter(x => x !== id) : old.length < pool.terms.max_inputs ? [...old, id] : old,
                      ),
                    id,
                  );
                })}
                <Text style={text}>Selected: {total.toLocaleString()} sats</Text>
                <Text style={text}>Estimated fee: {estimate} sats</Text>
                <Text style={text}>Change: {remainder === null ? 'Insufficient funds' : `${remainder.toLocaleString()} sats`}</Text>
              </View>
            )}
            <Text style={text}>Maximum fee (sats)</Text>
            <TextInput
              accessibilityLabel="Maximum fee in sats"
              keyboardType="number-pad"
              value={maxFee}
              onChangeText={setMaxFee}
              style={[styles.input, text]}
            />
            <Button
              title="Join pool and reserve coins"
              disabled={busy || !wallet || !pool || !selected.length || remainder === null}
              onPress={() => run(start)}
            />
          </>
        ) : (
          <>
            <View style={card}>
              <Text style={text}>Status: {progress?.title}</Text>
              <Text style={text}>
                Participants:{' '}
                {session && !session.seats.length && ['joining', 'open'].includes(session.phase)
                  ? 'Awaiting validation'
                  : session?.seats.length}
              </Text>
              <Text style={text}>
                Signatures: {signatureCount}/{inputCount}
              </Text>
              {!!view.review && (
                <Text style={text}>
                  Your mixed outputs: {view.review.count} × {view.review.amount.toLocaleString()} sats ={' '}
                  {view.review.total.toLocaleString()} sats
                </Text>
              )}
              {!!journal?.myFee && <Text style={text}>Your exact fee: {journal.myFee} sats</Text>}
              {!!journal?.reviewedId && (
                <Text selectable style={text}>
                  Transaction: {journal.reviewedId}
                </Text>
              )}
            </View>
            {!!progress && <SettingsFootnote>{progress.detail}</SettingsFootnote>}
            {session?.phase === 'signed' && journal?.phase === 'signed' && (
              <View style={[card, styles.completedStep]} testID="CoinjoinSigningComplete">
                <Text style={[styles.attentionTitle, styles.completedTitle]}>✓ Your signing is complete</Text>
                <Text style={text}>
                  {view.broadcastId
                    ? 'Transaction submitted. No action is required from you right now. Waiting for confirmation; refreshing the status is optional.'
                    : signatureCount === inputCount && inputCount > 0
                      ? 'All signatures are collected. Next action: broadcast the joint transaction, then wait for confirmation.'
                      : 'Waiting for the other participants to sign. Your signing step is done; broadcasting may still be needed once all signatures arrive.'}
                </Text>
                <Text style={text}>
                  Coins remain reserved until the transaction is resolved. Use Recovery options only if you need to troubleshoot.
                </Text>
              </View>
            )}
            {!!timing && (
              <View style={card} testID="CoinjoinRoundTiming">
                <Text style={text}>{timing.label}</Text>
                {!!active?.joinedAt && <Text style={text}>You joined {participationElapsed(active.joinedAt, clock)} ago</Text>}
                {!!timing.deadline && (
                  <Text style={text}>
                    {new Date(timing.deadline * 1000).toLocaleString()} · {poolCountdown(timing.deadline, clock)}
                  </Text>
                )}
                <Text style={text}>{timing.detail}</Text>
                {!!issue && (
                  <Text style={text}>
                    Connection or validation issue: this deadline is based on the last received state. It does not prove you are still
                    connected.
                  </Text>
                )}
              </View>
            )}
            {journal && !['complete', 'aborted'].includes(journal.phase) && (
              <SettingsFootnote>
                Back keeps access to this round while the app is running. Use Return to active pool to reopen it. Background reconnection
                and restart recovery are not yet guaranteed in RedWallet.
              </SettingsFootnote>
            )}
            {journal && ['complete', 'aborted'].includes(journal.phase) && (
              <Button
                title="Back to pools"
                disabled={busy}
                onPress={() => {
                  activePool.dismiss().catch(() => setError('Could not close the finished round.'));
                }}
              />
            )}
            {journal && Array.isArray(journal.reserved) && (
              <Text testID="CoinjoinReservationCount" style={text}>
                Reserved coins: {journal.reserved.length}
              </Text>
            )}
            {!!issue && journal && !['complete', 'aborted', 'signed', 'uncertain'].includes(journal.phase) && (
              <SettingsFootnote>You can stop participation to release this unsigned attempt's coin reservations.</SettingsFootnote>
            )}
            {journal?.phase === 'aborted' && journal.reserved.length === 0 && (
              <SettingsFootnote>Participation stopped. This round's coin reservations have been released.</SettingsFootnote>
            )}
            {session?.phase === 'open' && (
              <Button title="Request round closing" disabled={busy} onPress={() => run(() => client.current!.requestClose())} />
            )}
            {session?.phase === 'voting' && (
              <>
                <Button title="Accept round closing" disabled={busy} onPress={() => run(() => client.current!.vote(true))} />
                <Button title="Decline" disabled={busy} onPress={() => run(() => client.current!.vote(false))} />
              </>
            )}
            {session?.phase === 'closing' && (
              <Button
                title="Retry output registration"
                disabled={busy || !session.outputNotBefore || Math.floor(Date.now() / 1000) < session.outputNotBefore}
                onPress={() => run(() => client.current!.retryOutput())}
              />
            )}
            {session?.phase === 'review' && (
              <Button
                title="Review and sign"
                disabled={busy || !view.review}
                onPress={() => {
                  const commitment = journal!.commitment!;
                  const approvingClient = client.current;
                  Alert.alert(
                    'Approve CoinJoin transaction?',
                    `You receive ${view.review!.count} mixed output(s) of ${view.review!.amount.toLocaleString()} sats each, totaling ${view.review!.total.toLocaleString()} sats, on fresh addresses. Change: ${view.review!.change.toLocaleString()} sats (not mixed). Your fee is ${journal!.myFee} sats. Once signed, cancellation cannot release these coins until the transaction is resolved.`,
                    [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Sign transaction',
                        onPress: () =>
                          run(async () => {
                            if (!approvingClient || activePool.snapshot()?.client !== approvingClient)
                              throw new Error('The reviewed pool is no longer active');
                            await approvingClient.approve(commitment);
                          }),
                      },
                    ],
                  );
                }}
              />
            )}
            {session?.phase === 'signed' && journal?.phase !== 'complete' && (
              <>
                {!view.broadcastId && (
                  <Button
                    title="Broadcast joint transaction"
                    disabled={busy || signatureCount !== inputCount || !!view.broadcastId}
                    onPress={() => run(() => client.current!.broadcast())}
                  />
                )}
                <Button
                  title="Refresh confirmation status (optional)"
                  disabled={busy}
                  onPress={() =>
                    run(async () => {
                      if (!(await client.current!.checkConfirmation())) setError('Not confirmed yet. Coins remain reserved.');
                    })
                  }
                />
              </>
            )}
            {session?.phase === 'signed' && journal?.phase === 'signed' && (
              <>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showRecovery }}
                  onPress={() => setShowRecovery(old => !old)}
                >
                  <Text style={text}>{showRecovery ? 'Hide recovery options' : 'Recovery options'}</Text>
                </Pressable>
                {showRecovery && (
                  <>
                    <SettingsFootnote>
                      These are recovery controls, not additional signing steps. Stopping after signing does not release reserved coins.
                    </SettingsFootnote>
                    <Button title="Retry sharing signatures" disabled={busy} onPress={() => run(() => client.current!.retrySignatures())} />
                  </>
                )}
              </>
            )}
            {journal &&
              !['complete', 'aborted'].includes(journal.phase) &&
              (session?.phase !== 'signed' || journal.phase !== 'signed' || showRecovery) && (
                <Button
                  title="Stop participation"
                  disabled={busy}
                  onPress={() =>
                    run(async () => {
                      await client.current!.close();
                    })
                  }
                />
              )}
            {journal?.phase === 'uncertain' && (
              <Button
                title="Check retained round confirmation"
                disabled={busy}
                onPress={() =>
                  run(async () => {
                    if (!(await client.current!.checkConfirmation())) throw new Error('Not confirmed yet; coins remain reserved');
                  })
                }
              />
            )}
            {journal?.phase === 'uncertain' && (
              <SettingsFootnote>
                Your signature may have been shared. These coins remain reserved; closing the screen does not unlock them.
              </SettingsFootnote>
            )}
          </>
        )}
        <SettingsFootnote>Powered by Kilojoin · by Kilombino</SettingsFootnote>
      </View>
    </SettingsScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  title: { fontSize: 30, fontWeight: '700' },
  badge: {
    color: '#F3C15D',
    backgroundColor: '#392B12',
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    fontWeight: '600',
  },
  card: { borderRadius: 18, padding: 18, gap: 10 },
  choice: { paddingVertical: 12 },
  input: { borderWidth: 1, borderColor: '#777', borderRadius: 10, padding: 12 },
  completedStep: { borderWidth: 2, borderColor: '#248445' },
  completedTitle: { color: '#248445' },
  attention: { borderWidth: 2, borderColor: '#D3263E' },
  attentionTitle: { fontSize: 20, fontWeight: '700' },
  error: { color: '#D3263E' },
});
