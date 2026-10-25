import type { ClientView, MixingClient } from './client';
import type { MixingWallet } from './wallet-adapter';

type ActivePool = {
  wallet: MixingWallet;
  client?: MixingClient;
  view?: ClientView;
  busy: boolean;
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
    const active: ActivePool = { wallet, busy: true };
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
