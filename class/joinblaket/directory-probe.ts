// Explicit read-only native qualification. Never accesses a wallet or sends fill/PoDLE/transaction messages.
import { createIosDirectoryClient } from './ios-transport';
import { NickIdentity } from './nick';
import { fetchOrderbook } from './orderbook';
import type { DirectoryClient } from './directory';

export type ProbeStage = 'identity' | 'authentication' | 'orderbook';
export type DirectoryProbeResult = Readonly<{
  authenticated: true;
  certifiedOffers: number;
  makers: number;
  peers: number;
  heard: number;
  dropped: number;
  chainVerified: false;
  paymentsEnabled: false;
}>;
type Dependencies = Readonly<{
  identity: () => Promise<NickIdentity>;
  client: (identity: NickIdentity) => DirectoryClient;
}>;
const native: Dependencies = { identity: () => NickIdentity.random(), client: createIosDirectoryClient };
export class DirectoryProbeError extends Error {
  constructor(
    readonly stage: ProbeStage,
    readonly reason: 'failed' | 'cancelled' | 'timeout',
  ) {
    super(`JoinBlaket ${stage}: ${reason}`);
    this.name = 'DirectoryProbeError';
  }
}

/** A fresh identity per attempt, a five-minute total budget, and cleanup on every exit. */
export async function probeDirectory(
  options: Readonly<{ signal: AbortSignal; onStage?: (stage: ProbeStage) => void }>,
  dependencies: Dependencies = native,
): Promise<DirectoryProbeResult> {
  const signal = options.signal,
    onStage = options.onStage,
    makeIdentity = dependencies.identity,
    makeClient = dependencies.client;
  let stage: ProbeStage = 'identity';
  if (signal.aborted) throw new DirectoryProbeError(stage, 'cancelled');
  const controller = new AbortController();
  let identity: NickIdentity | undefined,
    client: DirectoryClient | undefined,
    stopped = false;
  const close = () => {
    try {
      client?.close();
    } catch {}
  };
  let interrupt!: (error: Error) => void;
  const interruption = new Promise<never>((_resolve, reject) => {
    interrupt = reject;
  });
  const stop = (reason: 'cancelled' | 'timeout') => {
    if (stopped) return;
    stopped = true;
    controller.abort();
    close();
    interrupt(new DirectoryProbeError(stage, reason));
  };
  const cancel = () => stop('cancelled');
  const timer = setTimeout(() => stop('timeout'), 300_000);
  signal.addEventListener('abort', cancel, { once: true });
  const check = () => {
    if (stopped || signal.aborted) throw new DirectoryProbeError(stage, 'cancelled');
  };
  const progress = (next: ProbeStage) => {
    check();
    stage = next;
    onStage?.(stage);
    check();
  };
  try {
    if (signal.aborted) cancel();
    return await Promise.race([
      interruption,
      (async () => {
        progress('identity');
        const created = await makeIdentity();
        // Entropy acquisition itself may not be cancellable. Never let a late
        // completion open Tor or leave its newly created secret alive.
        if (stopped || signal.aborted) {
          created.destroy();
          check();
        }
        identity = created;
        progress('authentication');
        client = makeClient(identity);
        await client.connect(controller.signal);
        check();
        if (!client.authenticated) throw new Error('Authentication not completed');
        progress('orderbook');
        const book = await fetchOrderbook(client, { signal: controller.signal });
        check();
        if (!client.authenticated || book.truncated) throw new Error('Incomplete orderbook');
        return Object.freeze({
          authenticated: true as const,
          certifiedOffers: book.offers.length,
          makers: new Set(book.offers.map(entry => entry.offer.counterparty)).size,
          peers: client.peers.size,
          heard: book.heard,
          dropped: book.dropped,
          chainVerified: false as const,
          paymentsEnabled: false as const,
        });
      })(),
    ]);
  } catch (error) {
    if (error instanceof DirectoryProbeError) throw error;
    throw new DirectoryProbeError(stage, signal.aborted ? 'cancelled' : 'failed');
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    controller.abort();
    close();
    identity?.destroy();
  }
}
