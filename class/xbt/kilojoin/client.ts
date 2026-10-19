/** Native orchestration. Kept behind the release gate until live/device qualification. */
import { address, Transaction } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../../blue_modules/BlueElectrum';
import { BlueApp } from '../../blue-app';
import { parseVerifiedParentTransaction } from '../verified-transaction';
import { NostrEvent } from './crypto';
import { changeMessage, LIVE_JOIN_ENABLED, parsePool, Terms } from './protocol';
import { KilojoinRelay, publishIsolated } from './relay';
import { Journal, Round } from './round';
import { Coin, change, ownershipMessage } from './transaction';
import { MixingWallet, nativeEntropy, observeCoins, walletSigner } from './wallet-adapter';
import { SessionVault } from './vault';
import { ParticipantSession, SessionState } from './session';
import { reservedCoins } from './wallet-store';
const ECPair = ECPairFactory(ecc);
const joining = new WeakSet<MixingWallet>();
const clock = () => Math.floor(Date.now() / 1000);
export type ClientView = { session: SessionState; journal: Journal; error?: string; broadcastId?: string };
export class MixingClient {
  private timer?: ReturnType<typeof setTimeout>;
  private broadcastId?: string;
  private error?: string;
  private closed = false;
  private constructor(
    readonly terms: Readonly<Terms>,
    private readonly wallet: MixingWallet,
    private readonly session: ParticipantSession,
    private readonly round: Round,
    private readonly relay: KilojoinRelay,
    private readonly mixAddress: string,
    private readonly changeAddress: string | undefined,
    private readonly onUpdate: (view: ClientView) => void,
  ) {
    if (wallet.getID() !== round.snapshot().walletId) throw new Error('Round wallet mismatch');
  }

  view(): ClientView {
    return { session: this.session.snapshot(), journal: this.round.snapshot(), error: this.error, broadcastId: this.broadcastId };
  }

  private update(): void {
    this.onUpdate(this.view());
  }

  private fail(message: string): void {
    this.error = message;
    this.update();
  }

  static async join(config: Parameters<typeof MixingClient.start>[0]): Promise<MixingClient> {
    if (!LIVE_JOIN_ENABLED) throw new Error('Live CoinJoin is not enabled');
    if (joining.has(config.wallet)) throw new Error('Wallet is already joining a round');
    joining.add(config.wallet);
    try {
      return await MixingClient.start(config);
    } finally {
      joining.delete(config.wallet);
    }
  }

  private static async start(config: {
    poolEvent: NostrEvent;
    wallet: MixingWallet;
    selected: string[];
    maxFee: number;
    password?: string;
    onUpdate(view: ClientView): void;
  }): Promise<MixingClient> {
    if (!LIVE_JOIN_ENABLED) throw new Error('Live CoinJoin is not enabled');
    const app = BlueApp.getInstance(),
      wallet = config.wallet,
      terms = parsePool(config.poolEvent, clock());
    if (!app.wallets.includes(wallet) || wallet.segwitType !== terms.script || reservedCoins(wallet).size)
      throw new Error('Select a compatible wallet without an active round');
    if (
      !Number.isSafeInteger(config.maxFee) ||
      config.maxFee < 0 ||
      config.selected.length < 1 ||
      config.selected.length > terms.max_inputs ||
      new Set(config.selected).size !== config.selected.length
    )
      throw new Error('Invalid coin selection or fee limit');
    await wallet.fetchUtxo();
    const available = wallet.getUtxo(),
      selected = config.selected.map(id => available.find(c => `${c.txid}:${c.vout}` === id));
    if (selected.some(c => !c)) throw new Error('Selected coins are no longer available');
    let joinSecret: Uint8Array;
    do {
      joinSecret = nativeEntropy(32);
    } while (!ecc.isPrivate(joinSecret));
    const joinPub = Buffer.from(ecc.pointFromScalar(joinSecret, true)!.slice(1)).toString('hex');
    const keys = selected.map(c => {
      const wif = wallet._getWifForAddress(c!.address);
      if (!wif) throw new Error('Selected coin spending key unavailable');
      return ECPair.fromWIF(wif);
    });
    const coins: Coin[] = selected.map((c, i) => ({
      txid: c!.txid,
      vout: c!.vout,
      value: c!.value,
      pubkey: Buffer.from(keys[i].publicKey).toString('hex'),
      type: terms.script,
    }));
    await observeCoins(coins);
    const total = coins.reduce((sum, c) => sum + c.value, 0),
      remainder = change(total, terms.denomination, terms.fee_rate, coins.length, terms.script);
    if (remainder === null || total - terms.denomination - remainder > config.maxFee)
      throw new Error('Selected coins exceed the approved fee or are insufficient');
    const mixAddress = await wallet.getAddressAsync(),
      changeAddress = remainder > 0 ? await wallet.getChangeAddressAsync() : undefined;
    const mixScript = Buffer.from(address.toOutputScript(mixAddress)).toString('hex');
    const changeScript = changeAddress ? Buffer.from(address.toOutputScript(changeAddress)).toString('hex') : '';
    const seat = {
      token_hash: '00'.repeat(32),
      join_pub: joinPub,
      coins,
      change_script: changeScript,
      change_value: remainder,
      proofs: coins.map((c, i) => Buffer.from(ecc.signDER(ownershipMessage(terms.id, joinPub, c), keys[i].privateKey!)).toString('hex')),
    };
    const changeSignature = Buffer.from(ecc.signDER(changeMessage(terms.id, coins, changeScript, remainder), keys[0].privateKey!)).toString(
      'hex',
    );
    const store = app.createKilojoinJournalStore(wallet),
      start = clock();
    const round = await Round.join(wallet.getID(), terms.id, config.selected, Math.min(terms.timeout + 1500, start + 7200), start, store);
    const vault = new SessionVault(wallet.getID(), terms.id);
    const subscribe = () => relay.subscribe([terms.creator, terms.public_key], [joinPub, terms.public_key], start - 60);
    const relay = new KilojoinRelay(
      async event => {
        const before = session.snapshot().phase;
        await session.receive(event);
        if (before === 'joining' && session.snapshot().phase === 'open') subscribe();
        const state = session.snapshot();
        if (state.phase === 'closing' && state.outputNotBefore && client && !client.timer) {
          client.timer = setTimeout(
            () => {
              if (client?.closed) return;
              session
                .submitOutput()
                .then(() => client?.update())
                .catch(() => client?.fail('Output registration failed; retry or cancel the round.'));
            },
            Math.max(0, state.outputNotBefore - clock()) * 1000,
          );
        }
        client?.update();
      },
      () => client?.fail('Relay message or connection failed. Coins remain reserved until the round is resolved.'),
    );
    const session = new ParticipantSession(terms, seat, joinSecret, mixScript, config.maxFee, round, {
      now: clock,
      random: nativeEntropy,
      saveEncrypted: state => vault.save(state),
      observe: coinsToCheck => observeCoins(coinsToCheck),
      walletOutpoints: () =>
        new Set([
          ...config.selected,
          ...app.wallets.flatMap(w =>
            'getDerivedUtxoFromOurTransaction' in w ? w.getDerivedUtxoFromOurTransaction(true).map(c => `${c.txid}:${c.vout}`) : [],
          ),
        ]),
      publish: (event, isolated) => (isolated ? publishIsolated(event) : relay.publish(event)),
    });
    const client = new MixingClient(terms, wallet, session, round, relay, mixAddress, changeAddress, config.onUpdate);
    try {
      await relay.connect();
      subscribe();
      await session.sendJoin(changeSignature, config.password);
      client.update();
      return client;
    } catch (error) {
      relay.close();
      await round.cancel();
      throw error;
    } finally {
      joinSecret.fill(0);
    }
  }

  async requestClose(): Promise<void> {
    await this.session.requestClose();
    this.update();
  }

  async vote(accept: boolean): Promise<void> {
    await this.session.vote(accept);
    this.update();
  }

  async retryOutput(): Promise<void> {
    await this.session.submitOutput();
    this.update();
  }

  async retrySignatures(): Promise<void> {
    await this.session.retrySignatures();
    this.update();
  }

  async approve(commitment: string): Promise<void> {
    await this.session.signApproved(commitment, walletSigner(this.wallet, this.round));
    this.update();
  }

  async broadcast(): Promise<void> {
    if (this.closed) throw new Error('Client closed');
    const raw = this.session.completedTransaction();
    if (!(await this.wallet.broadcastTx(raw))) throw new Error('Backend did not accept the transaction');
    this.broadcastId = Transaction.fromHex(raw).getId();
    this.update();
  }

  async checkConfirmation(): Promise<boolean> {
    const id = this.round.snapshot().reviewedId;
    if (!id || !['signed', 'uncertain'].includes(this.round.snapshot().phase)) throw new Error('No signed round to confirm');
    const [transactions, histories, tip] = await Promise.all([
      BlueElectrum.multiGetTransactionByTxid([id], false, 45, true),
      BlueElectrum.multiGetHistoryByAddress([this.mixAddress]),
      BlueElectrum.getReportedBlockTip(),
    ]);
    const tx = parseVerifiedParentTransaction(id, transactions[id]);
    const entries = (histories[this.mixAddress] || []).filter(h => h.tx_hash === id);
    if (
      tip === null ||
      !Number.isSafeInteger(tip) ||
      entries.length !== 1 ||
      !Number.isSafeInteger(entries[0].height) ||
      entries[0].height <= 0 ||
      entries[0].height > tip
    )
      return false;
    // Keep change frozen to prevent immediate recombination with equal-denomination output.
    for (let index = 0; index < tx.outs.length; index++) {
      let a: string;
      try {
        a = address.fromOutputScript(tx.outs[index].script);
      } catch {
        continue;
      }
      if (a === this.mixAddress) this.wallet.setUTXOMetadata(id, index, { memo: 'CoinJoin output · Kilojoin' });
      if (a === this.changeAddress)
        this.wallet.setUTXOMetadata(id, index, { memo: 'CoinJoin change · frozen to avoid recombination', frozen: true });
    }
    await this.round.confirm(id, tip - entries[0].height + 1);
    this.broadcastId = id;
    this.update();
    this.relay.close();
    return true;
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    this.relay.close();
    if (!['complete', 'aborted'].includes(this.round.snapshot().phase)) await this.session.cancel();
    this.update();
  }
}

/** Restart conservatively: unsigned rounds abort; potentially shared signatures stay reserved. */
export async function recoverWalletRounds(wallet: MixingWallet): Promise<Journal[]> {
  const app = BlueApp.getInstance(),
    store = app.createKilojoinJournalStore(wallet);
  reservedCoins(wallet); // Reject malformed state before any recovery mutations.
  const result: Journal[] = [];
  for (const journal of Object.values(wallet._kilojoinJournals || {})) {
    if (['complete', 'aborted'].includes(journal.phase)) continue;
    result.push((await Round.restore(journal, wallet.getID(), clock(), store)).snapshot());
  }
  return result;
}
export async function confirmRecoveredRound(wallet: MixingWallet, poolId: string): Promise<boolean> {
  reservedCoins(wallet);
  const stored = wallet._kilojoinJournals?.[poolId];
  if (!stored || !['signed', 'uncertain'].includes(stored.phase) || !stored.reviewedId || !stored.reviewedHex)
    throw new Error('No signed round to recover');
  const id = stored.reviewedId,
    expected = Transaction.fromHex(stored.reviewedHex);
  const own: { address: string; index: number }[] = [];
  expected.outs.forEach((output, index) => {
    try {
      const a = address.fromOutputScript(output.script);
      if (wallet.weOwnAddress(a)) own.push({ address: a, index });
    } catch {
      /* unsupported output */
    }
  });
  if (!own.length) throw new Error('Recovered transaction has no wallet output');
  const addresses = [...new Set(own.map(o => o.address))];
  const [raw, history, tip] = await Promise.all([
    BlueElectrum.multiGetTransactionByTxid([id], false, 45, true),
    BlueElectrum.multiGetHistoryByAddress(addresses),
    BlueElectrum.getReportedBlockTip(),
  ]);
  parseVerifiedParentTransaction(id, raw[id]);
  if (tip === null || !Number.isSafeInteger(tip)) return false;
  const heights = addresses.map(a => (history[a] || []).filter(h => h.tx_hash === id));
  if (
    heights.some(h => h.length !== 1 || !Number.isSafeInteger(h[0].height) || h[0].height < 1 || h[0].height > tip) ||
    new Set(heights.map(h => h[0].height)).size !== 1
  )
    return false;
  const store = BlueApp.getInstance().createKilojoinJournalStore(wallet);
  const round = await Round.restore(stored, wallet.getID(), clock(), store);
  // Role metadata might not survive an interrupted session. Freeze every recovered
  // wallet output instead of guessing which equal output/change should be combined.
  for (const output of own)
    wallet.setUTXOMetadata(id, output.index, { memo: 'Recovered CoinJoin output · review before unfreezing', frozen: true });
  await round.confirm(id, tip - heights[0][0].height + 1);
  return true;
}
