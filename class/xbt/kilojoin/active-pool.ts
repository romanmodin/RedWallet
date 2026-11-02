import { Alert, AppState } from 'react-native';
import { closingResponse, signingProgress } from './participation-progress';
import { RoundAttentionMonitor } from './attention';
import type { ClientView, MixingClient } from './client';
import type { MixingWallet } from './wallet-adapter';

type ActivePool = {
  wallet: MixingWallet;
  client?: MixingClient;
  view?: ClientView;
  busy: boolean;
  joinedAt: number;
  automatic?: boolean;
  autoIssue?: string;
  requestedClose?: boolean;
  reconnectAfter?: number;
  confirmAfter?: number;
};
type Listener = (active: Readonly<ActivePool> | undefined) => void;

/** App-process owner. Navigation never cancels a round or persists session secrets.
 * Process restart still uses the existing conservative durable-journal recovery.
 */
export class ActivePoolController {
  private active?: ActivePool;
  private readonly listeners = new Set<Listener>();

  snapshot(): Readonly<ActivePool> | undefined {
    return this.active ? { ...this.active } : undefined;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot());
      } catch {
        // A detached/broken view cannot cancel participation or change a durable transition.
      }
    }
  }

  async start(wallet: MixingWallet, join: (onUpdate: (view: ClientView) => void) => Promise<MixingClient>): Promise<MixingClient> {
    if (this.active) throw new Error('Return to the existing pool before starting another round');
    const active: ActivePool = {
      wallet,
      busy: true,
      joinedAt: Math.floor(Date.now() / 1000),
    };
    this.active = active;
    this.notify();
    try {
      const client = await join(view => {
        active.view = view;
        this.notify();
      });
      active.client = client;
      active.view = client.view();
      return client;
    } catch (error) {
      // MixingClient.join already performs its guarded failure cleanup.
      this.active = undefined;
      throw error;
    } finally {
      active.busy = false;
      this.notify();
    }
  }

  async perform(action: () => Promise<void>): Promise<void> {
    const active = this.active;
    if (!active?.client || active.busy) throw new Error('A pool action is already pending');
    active.busy = true;
    this.notify();
    try {
      await action();
    } finally {
      active.busy = false;
      this.notify();
    }
  }

  setAutomatic(client: MixingClient, enabled: boolean): void {
    const active = this.active;
    if (!active || active.client !== client || !active.view || active.busy) throw new Error('Pool is no longer available');
    if (enabled && (active.view.error || !['open', 'voting', 'closing', 'review'].includes(active.view.session.phase)))
      throw new Error('Check the current pool status before authorizing it');
    active.automatic = enabled;
    active.autoIssue = undefined;
    this.notify();
  }

  async advance(now: number): Promise<void> {
    const active = this.active;
    if (!active?.client || !active.view || active.busy) return;
    const { client, view } = active;
    const { journal, session } = view;
    if (active.automatic && view.broadcastId && journal.phase === 'signed') {
      if (now >= (active.confirmAfter ?? 0)) {
        active.confirmAfter = now + 60;
        try {
          await this.perform(() => client.checkConfirmation().then(() => {}));
        } catch {
          // A temporary backend failure leaves the verified transaction reserved for the next check.
        }
      }
      return;
    }
    if (['complete', 'aborted', 'uncertain'].includes(journal.phase) || now >= journal.deadline) return;
    if (view.relayInterrupted) {
      if (now < (active.reconnectAfter ?? 0)) return;
      active.reconnectAfter = now + 20;
      await this.perform(() => client.reconnectRelay());
      return;
    }
    if (!active.automatic || view.error || now >= session.deadline) return;
    try {
      if (session.phase === 'open' && session.seats.length >= client.terms.min_peers && !active.requestedClose) {
        active.requestedClose = true;
        await this.perform(() => client.requestClose());
      } else if (session.phase === 'voting' && session.voteId && closingResponse(session) === undefined) {
        await this.perform(() => client.vote(true));
      } else if (session.phase === 'review' && journal.phase === 'review' && journal.commitment && view.review) {
        const commitment = journal.commitment;
        await this.perform(() => client.approve(commitment));
      } else if (session.phase === 'signed' && journal.phase === 'signed' && !view.broadcastId) {
        const progress = signingProgress(session);
        if (progress.inputs > 0 && progress.signatures === progress.inputs) await this.perform(() => client.broadcast());
      }
    } catch {
      active.automatic = false;
      active.autoIssue = 'Automatic participation paused. Open this round to review its status before continuing.';
      this.notify();
    }
  }

  async dismiss(): Promise<void> {
    const active = this.active;
    if (!active?.client || active.busy || !active.view || !['aborted', 'complete'].includes(active.view.journal.phase))
      throw new Error('An unresolved pool must remain available');
    await this.perform(() => active.client!.close());
    if (this.active !== active || !active.view || !['aborted', 'complete'].includes(active.view.journal.phase))
      throw new Error('The round is not resolved');
    this.active = undefined;
    this.notify();
  }
}

export const activePool = new ActivePoolController();

// App-process notices work after Back navigation too. No background delivery promise:
// iOS may suspend this process, so foregrounding rechecks the absolute deadline.
let attentionTimer: ReturnType<typeof setInterval> | undefined;
let attentionClient: MixingClient | undefined;
let attentionMonitor = new RoundAttentionMonitor();
const checkAttention = () => {
  const active = activePool.snapshot();
  if (!active?.client || !active.view) return;
  if (attentionClient !== active.client) {
    attentionClient = active.client;
    attentionMonitor = new RoundAttentionMonitor();
  }
  if (AppState.currentState === 'active') activePool.advance(Math.floor(Date.now() / 1000));
  if (active.automatic && !active.view.error) return;
  const notice = attentionMonitor.check(active.view, Math.floor(Date.now() / 1000), AppState.currentState === 'active', active.busy);
  if (notice) Alert.alert(notice.title, notice.detail, [{ text: 'OK' }]);
};
activePool.subscribe(active => {
  const unresolved = active && !['complete', 'aborted'].includes(active.view?.journal.phase ?? '');
  if (unresolved && !attentionTimer) attentionTimer = setInterval(checkAttention, 1000);
  if (!unresolved && attentionTimer) {
    clearInterval(attentionTimer);
    attentionTimer = undefined;
  }
});
let backgroundClient: MixingClient | undefined;
AppState.addEventListener('change', state => {
  const active = activePool.snapshot();
  if (state === 'background') backgroundClient = active?.client;
  if (state === 'active') {
    if (
      backgroundClient &&
      active?.client === backgroundClient &&
      active.view &&
      !active.view.broadcastId &&
      active.view.session.phase !== 'joining' &&
      !['complete', 'aborted', 'uncertain'].includes(active.view.journal.phase)
    )
      backgroundClient.interruptRelay();
    backgroundClient = undefined;
    checkAttention();
  }
});
