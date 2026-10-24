/** Bounded Nostr transport. No automatic reconnect, signing, approval or transaction broadcast. */
import { hex, NostrEvent, verifyEvent } from './crypto';
import { RELAY } from './protocol';
import { participantFailure } from './relay-error';
export type SocketFactory = (url: string) => WebSocket;
export class KilojoinRelay {
  private socket?: WebSocket;
  private opening?: Promise<void>;
  private rejectOpening?: (error: Error) => void;
  private closed = false;
  private open = false;
  private queued = 0;
  private sequence = Promise.resolve();
  private readonly acknowledgements = new Map<
    string,
    {
      resolve(): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  private discovery?: {
    resolve(): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
  };

  private subscription?: string;
  private subscriptionGeneration = 0;
  private subscriptionKind = 2023;
  constructor(
    private readonly onEvent: (event: NostrEvent) => Promise<void>,
    private readonly onError: (error: Error) => void,
    private readonly factory: SocketFactory = url => new WebSocket(url),
  ) {
    if (typeof factory !== 'function') throw new Error('Missing socket factory');
  }

  connect(): Promise<void> {
    if (this.closed) return Promise.reject(new Error('Relay closed'));
    if (this.opening) return this.opening;
    this.opening = new Promise<void>((resolve, reject) => {
      this.rejectOpening = reject;
      const timer = setTimeout(() => this.close(), 15000);
      let socket: WebSocket;
      try {
        socket = this.factory(RELAY);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      this.socket = socket;
      socket.onopen = () => {
        clearTimeout(timer);
        this.rejectOpening = undefined;
        this.open = true;
        resolve();
      };
      socket.onerror = () => {
        if (!this.closed) this.onError(new Error('Relay connection error'));
        clearTimeout(timer);
        this.close();
      };
      socket.onclose = () => {
        if (!this.closed) this.onError(new Error('Relay disconnected'));
        clearTimeout(timer);
        this.close();
      };
      socket.onmessage = event => this.message(event.data);
    });
    return this.opening;
  }

  private send(message: unknown[]): void {
    if (!this.open || this.closed || !this.socket) throw new Error('Relay is not connected');
    this.socket.send(JSON.stringify(message));
  }

  subscribe(authors: string[], recipients: string[], since?: number): void {
    if (
      authors.length < 1 ||
      authors.length > 3 ||
      recipients.length < 1 ||
      recipients.length > 2 ||
      (since !== undefined && (!Number.isSafeInteger(since) || since < 0))
    )
      throw new Error('Invalid relay subscription');
    authors.forEach(key => hex(key, 32));
    recipients.forEach(key => hex(key, 32));
    if (this.subscription) this.send(['CLOSE', this.subscription]);
    this.subscriptionKind = 2023;
    this.subscription = `kilojoin-participant-${++this.subscriptionGeneration}`;
    this.send([
      'REQ',
      this.subscription,
      { kinds: [2023], authors, '#p': recipients, ...(since === undefined ? {} : { since }), limit: 256 },
    ]);
  }

  discoverPools(since: number): Promise<void> {
    if (!Number.isSafeInteger(since) || since < 0) return Promise.reject(new Error('Invalid discovery time'));
    if (this.discovery) return Promise.reject(new Error('Pool search already in progress'));
    if (this.subscription) this.send(['CLOSE', this.subscription]);
    this.subscriptionKind = 32022;
    this.subscription = `kilojoin-pools-${++this.subscriptionGeneration}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.onError(new Error('Pool search timed out. Try again.'));
        this.close();
      }, 15000);
      this.discovery = { resolve, reject, timer };
      try {
        // Nostr indexes only single-letter tags. The live relay rejects
        // #network; parsePool validates the signed network locally instead.
        this.send(['REQ', this.subscription, { kinds: [32022], '#t': ['kilojoin'], since, limit: 256 }]);
      } catch (error) {
        clearTimeout(timer);
        this.discovery = undefined;
        reject(error);
      }
    });
  }

  publish(event: NostrEvent): Promise<void> {
    if (!verifyEvent(event) || event.kind !== 2023) return Promise.reject(new Error('Invalid published event'));
    if (this.acknowledgements.has(event.id) || this.acknowledgements.size >= 32)
      return Promise.reject(new Error('Publish already pending or full'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.acknowledgements.delete(event.id);
        reject(new Error('Relay publication not acknowledged'));
      }, 15000);
      this.acknowledgements.set(event.id, { resolve, reject, timer });
      try {
        this.send(['EVENT', event]);
      } catch (error) {
        clearTimeout(timer);
        this.acknowledgements.delete(event.id);
        reject(error);
      }
    });
  }

  private message(data: unknown): void {
    if (this.closed || typeof data !== 'string' || data.length > 150000) return;
    let message: unknown;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (!Array.isArray(message)) return;
    if (message[0] === 'OK' && typeof message[1] === 'string') {
      const pending = this.acknowledgements.get(message[1]);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.acknowledgements.delete(message[1]);
      if (message[2] === true) pending.resolve();
      else pending.reject(new Error('Relay rejected publication'));
    } else if (message[0] === 'CLOSED' && this.subscription && message[1] === this.subscription) {
      this.onError(new Error('Relay rejected the subscription. Try again.'));
      this.close();
    } else if (message[0] === 'NOTICE' && this.discovery) {
      this.onError(new Error('Relay could not complete the pool search. Try again.'));
      this.close();
    } else if (message[0] === 'EOSE' && this.discovery && message[1] === this.subscription) {
      const pending = this.discovery;
      const subscription = this.subscription;
      // Finish only after the preceding signed announcements were processed.
      this.sequence = this.sequence.then(() => {
        if (this.closed || this.subscription !== subscription || this.discovery !== pending) return;
        clearTimeout(pending.timer);
        this.discovery = undefined;
        pending.resolve();
      });
    } else if (message[0] === 'EVENT' && this.subscription && message[1] === this.subscription && message.length === 3) {
      const event = message[2] as NostrEvent;
      if (!verifyEvent(event) || event.kind !== this.subscriptionKind) return;
      if (this.queued >= 256) {
        this.onError(new Error('Relay message queue exceeded'));
        this.close();
        return;
      }
      const subscription = this.subscription;
      this.queued++;
      this.sequence = this.sequence
        .then(async () => {
          if (!this.closed && this.subscription === subscription) await this.onEvent(event);
        })
        .catch(error => {
          // A stopped attempt must not overwrite the next attempt's UI with a late rejection.
          if (!this.closed) this.onError(participantFailure(error));
        })
        .finally(() => {
          this.queued--;
        });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.rejectOpening?.(new Error('Relay connection closed'));
    this.rejectOpening = undefined;
    for (const pending of this.acknowledgements.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Relay connection closed'));
    }
    this.acknowledgements.clear();
    if (this.discovery) {
      clearTimeout(this.discovery.timer);
      this.discovery.reject(new Error('Pool search did not complete. Try again.'));
      this.discovery = undefined;
    }
    this.socket?.close();
  }
}
/** Separate output socket and identity reduce direct linkage, but do NOT hide the device IP. */
export async function publishIsolated(event: NostrEvent, factory?: SocketFactory): Promise<void> {
  const relay = new KilojoinRelay(
    async () => {},
    () => {},
    factory,
  );
  try {
    await relay.connect();
    await relay.publish(event);
  } finally {
    relay.close();
  }
}
