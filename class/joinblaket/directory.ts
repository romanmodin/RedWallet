// Adapted from Kilowallet rc6 DirectoryClient.kt / Network.kt, Apache-2.0.
// Upstream pin: 6a07be1835dc650a6274a90eb0ffeb214b5310ef.
// Only an injected transport opens a connection. No wallet, spending or key ownership here.
import { NickIdentity, checkDirectoryReply, handshakeLine, isValidNick, parseChallenge, proofLine, resultOk } from './nick';
import * as Wire from './wire';

export const DIRECTORY_HOST = 'f3tfzgk5ilwfapx427yx5ckeh7ptuvskfxnfnicfo747jyq5mgzdtvad.onion';
export const DIRECTORY_PORT = 5222;
export const DIRECTORY_ID = DIRECTORY_HOST + ':' + DIRECTORY_PORT;
export const DIRECTORY_NETWORK = 'xbt';
const MAX_QUEUE = 1024,
  MAX_BYTES = 8 * 1024 * 1024,
  MAX_PEERS = 20_000,
  MAX_WRITES = 64;
const PEERLIST_INTERVAL = 60_000;

export interface DirectoryLineStream {
  readLine(): Promise<string | null>;
  /** Appends LF; caller includes the CR for CRLF. */
  writeLine(line: string): Promise<void>;
  close(): void | Promise<void>;
}
export interface DirectoryTransport {
  /** A contract, not independent proof of routing: the native implementation must enforce Tor. */
  readonly viaTor: true;
  open(host: string, port: number, signal: AbortSignal): Promise<DirectoryLineStream>;
}
export type Peer = Readonly<{ nick: string; location: string; features: readonly string[] }>;
type Entry = Readonly<{ peer: Peer; left: boolean }>;
type Timings = Readonly<{ connect: number; auth: number; write: number; peerlist: number; quiet: number }>;
export type DirectoryOptions = Readonly<{
  identity: NickIdentity;
  transport: DirectoryTransport;
  timeouts?: Partial<Timings>;
  now?: () => number;
}>;

export class DirectoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DirectoryError';
  }
}
const problem = (message = 'Directory connection closed') => new DirectoryError(message);
const byteLength = (text: string) => Buffer.byteLength(text, 'utf8');
function safeField(text: string, max: number): boolean {
  return (
    !!text &&
    byteLength(text) <= max &&
    !/[,;!\s]/.test(text) &&
    !Array.from(text).some(ch => {
      const n = ch.charCodeAt(0);
      return n < 32 || (n >= 127 && n <= 159);
    })
  );
}
function peerBytes(peer: Peer): number {
  return byteLength(peer.nick) + byteLength(peer.location) + peer.features.reduce((n, f) => n + byteLength(f) + 1, 0) + 8;
}
function closeStream(stream: DirectoryLineStream): void {
  try {
    Promise.resolve(stream.close()).catch(() => {});
  } catch {}
}

/** Malformed peer entries are skipped, as upstream; frame size is bounded by the caller/parser. */
export function parsePeerlist(line: string): readonly Entry[] {
  if (typeof line !== 'string' || byteLength(line) > Wire.MAX_FRAME_LENGTH) throw problem('Peer list too large');
  const entries: Entry[] = [];
  for (const item of line.split(',')) {
    const [nick, location, ...parts] = item.split(';');
    if (!location || !safeField(nick, 64) || !safeField(location, 300)) continue;
    let left = false,
      features: string[] = [],
      valid = true;
    for (const part of parts) {
      if (part === 'D') left = true;
      if (part.startsWith('F:')) {
        features = [...new Set(part.slice(2).split('+').filter(Boolean))];
        if (features.length > 64 || features.some(f => !safeField(f, 64) || f.includes('+'))) valid = false;
      }
    }
    if (valid) entries.push(Object.freeze({ peer: Object.freeze({ nick, location, features: Object.freeze(features) }), left }));
  }
  return Object.freeze(entries);
}

type Collector = {
  peers: Map<string, Peer>;
  bytes: number;
  frames: number;
  received: boolean;
  deadline: number;
  timer: ReturnType<typeof setTimeout>;
  finish(error?: DirectoryError): void;
};

/** One authenticated directory connection. A closed/failed instance can never reconnect. */
export class DirectoryClient {
  private readonly identity: NickIdentity;
  private readonly transport: DirectoryTransport;
  private readonly timings: Timings;
  private readonly now: () => number;
  private readonly abort = new AbortController();
  private detachAbort?: () => void;
  private phase: 'new' | 'connecting' | 'ready' | 'closed' = 'new';
  private stream?: DirectoryLineStream;
  private waiters = new Set<(error: DirectoryError) => void>();
  private writeTail: Promise<void> = Promise.resolve();
  private queuedWrites = 0;
  private frames: Array<{ frame: Wire.Frame; bytes: number }> = [];
  private queuedBytes = 0;
  private receiver?: { finish(frame: Wire.Frame | null, error?: DirectoryError): void };
  private peerMap = new Map<string, Peer>();
  private peerSize = 0;
  private collector?: Collector;
  private lastPeerlist = -Infinity;
  private features: readonly string[] = Object.freeze([]);
  private greeting?: string;
  private directoryName?: string;

  constructor(options: DirectoryOptions) {
    if (
      !(options.identity instanceof NickIdentity) ||
      options.identity.destroyed ||
      !options.transport ||
      options.transport.viaTor !== true ||
      typeof options.transport.open !== 'function'
    )
      throw problem('Tor transport and identity required');
    this.identity = options.identity;
    this.transport = options.transport;
    this.now = options.now ?? (() => performance.now());
    const maximum: Timings = { connect: 120_000, auth: 30_000, write: 30_000, peerlist: 60_000, quiet: 5_000 };
    const timings = { ...maximum, ...options.timeouts };
    for (const key of Object.keys(maximum) as (keyof Timings)[]) {
      if (!Number.isSafeInteger(timings[key]) || timings[key] < 1 || timings[key] > maximum[key])
        throw problem('Invalid directory timeout');
    }
    this.timings = Object.freeze(timings);
  }

  get nick(): string {
    return this.identity.nick;
  }

  get authenticated(): boolean {
    return this.phase === 'ready';
  }

  get isConnected(): boolean {
    return this.phase === 'ready' && !!this.stream;
  }

  get directoryFeatures(): readonly string[] {
    return this.features;
  }

  get motd(): string | undefined {
    return this.greeting;
  }

  get directoryNick(): string | undefined {
    return this.directoryName;
  }

  get peers(): ReadonlyMap<string, Peer> {
    return new Map(this.peerMap);
  }

  private ready(): void {
    if (!this.authenticated || !this.stream) throw problem('Directory is not authenticated');
  }

  private bounded<T>(operation: Promise<T>, timeout: number): Promise<T> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (error?: unknown, value?: T) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.waiters.delete(cancel);
        if (error !== undefined) reject(error);
        else resolve(value as T);
      };
      const cancel = (error: DirectoryError) => finish(error);
      const timer = setTimeout(() => finish(problem('Directory operation timed out')), timeout);
      this.waiters.add(cancel);
      operation.then(
        value => finish(undefined, value),
        () => finish(problem('Directory transport failed')),
      );
      if (this.phase === 'closed') cancel(problem());
    });
  }

  async connect(signal?: AbortSignal): Promise<void> {
    if (this.phase !== 'new') throw problem('Connect once per directory client');
    this.phase = 'connecting';
    if (signal) {
      const cancel = () => this.close();
      this.detachAbort = () => signal.removeEventListener('abort', cancel);
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) this.close();
    }
    let opening: Promise<DirectoryLineStream> | undefined;
    try {
      if (this.abort.signal.aborted || this.identity.destroyed || this.transport.viaTor !== true) throw problem();
      opening = Promise.resolve(this.transport.open(DIRECTORY_HOST, DIRECTORY_PORT, this.abort.signal));
      const stream = await this.bounded(opening, this.timings.connect);
      if (this.abort.signal.aborted) {
        closeStream(stream);
        throw problem();
      }
      this.stream = stream;
      const hello = handshakeLine(this.nick, DIRECTORY_NETWORK, true);
      await this.sendFrame(Wire.HANDSHAKE, hello);
      const reply = await this.handshakeFrame(this.timings.connect);
      const refused = checkDirectoryReply(reply, DIRECTORY_NETWORK, true);
      if (refused) throw problem('Directory rejected the required handshake');
      const metadata = JSON.parse(reply.line) as Record<string, unknown>;
      const features = Object.entries(metadata.features as Record<string, unknown>)
        .filter(([, value]) => value === true)
        .map(([key]) => key);
      if (features.length > 64 || features.some(f => !/^[a-zA-Z0-9_-]{1,64}$/.test(f))) throw problem('Invalid directory features');
      this.features = Object.freeze(features);
      if (typeof metadata.motd === 'string' && byteLength(metadata.motd) <= 4096) this.greeting = metadata.motd;
      if (typeof metadata.nick === 'string' && safeField(metadata.nick, 64)) this.directoryName = metadata.nick;
      const challengeFrame = await this.handshakeFrame(Math.min(this.timings.connect, this.timings.auth));
      if (challengeFrame.type !== Wire.NICK_AUTH_CHALLENGE) throw problem('Out-of-order directory challenge');
      const challenge = parseChallenge(challengeFrame.line);
      if (challenge.directoryId !== DIRECTORY_ID) throw problem('Directory identity mismatch');
      await this.sendFrame(Wire.NICK_AUTH_PROOF, proofLine(this.identity, challenge, hello, DIRECTORY_ID, DIRECTORY_NETWORK));
      const result = await this.handshakeFrame(Math.min(this.timings.connect, this.timings.auth));
      if (result.type !== Wire.NICK_AUTH_RESULT || !resultOk(result.line)) throw problem('Directory authentication rejected');
      if (this.abort.signal.aborted) throw problem();
      this.phase = 'ready';
      this.readLoop().catch(() => this.close());
    } catch (error) {
      this.close();
      // Also covers an open promise resolving in the same turn as its timeout/abort.
      opening?.then(closeStream, () => {});
      throw error instanceof DirectoryError ? error : problem('Directory authentication failed');
    }
  }

  private async handshakeFrame(timeout: number): Promise<Wire.Frame> {
    const deadline = this.now() + timeout;
    for (let count = 0; count < 32; count++) {
      const remaining = deadline - this.now();
      if (remaining <= 0 || !this.stream) throw problem('Directory handshake timed out');
      const line = await this.bounded(this.stream.readLine(), remaining);
      if (line === null) throw problem();
      const frame = this.parse(line);
      if (frame.type === Wire.PING) {
        const left = deadline - this.now();
        if (left <= 0) throw problem('Directory handshake timed out');
        await this.bounded(this.sendFrame(Wire.PONG, ''), left);
        continue;
      }
      if (frame.type === Wire.PEERLIST) {
        this.onPeerlist(frame.line);
        continue;
      }
      return frame;
    }
    throw problem('Too many handshake control frames');
  }

  private parse(line: string): Wire.Frame {
    if (typeof line !== 'string' || byteLength(line) > Wire.MAX_FRAME_LENGTH) throw problem('Directory frame too large');
    return Wire.parse(line);
  }

  private sendFrame(type: number, line: string): Promise<void> {
    const text = Wire.envelope(type, line);
    if (byteLength(text) + 2 > Wire.MAX_FRAME_LENGTH) return Promise.reject(problem('Directory message too large'));
    if (this.queuedWrites >= MAX_WRITES) {
      this.close();
      return Promise.reject(problem('Directory write limit exceeded'));
    }
    this.queuedWrites++;
    const writing = this.writeTail.then(async () => {
      if (this.phase === 'closed' || !this.stream) throw problem();
      await this.stream.writeLine(text + '\r');
    });
    // The deadline includes time waiting behind earlier writes.
    const sending = this.bounded(writing, this.timings.write)
      .catch(error => {
        this.close();
        throw error instanceof DirectoryError ? error : problem('Directory write failed');
      })
      .finally(() => {
        this.queuedWrites--;
      });
    this.writeTail = sending.catch(() => {});
    return sending;
  }

  async sendPublic(message: string): Promise<void> {
    this.ready();
    if (
      typeof message !== 'string' ||
      !message ||
      byteLength(message) > Wire.MAX_FRAME_LENGTH ||
      /[\r\n]/.test(message) ||
      message.includes('\0')
    )
      throw problem('Invalid public directory message');
    await this.sendFrame(Wire.PUBMSG, this.nick + '!PUBLIC!' + message);
  }

  async sendPrivate(to: string, command: string, data: string): Promise<void> {
    this.ready();
    if (!isValidNick(to)) throw problem('Invalid directory recipient');
    if (typeof data !== 'string' || byteLength(data) > Wire.MAX_FRAME_LENGTH) throw problem('Directory message too large');
    await this.sendFrame(Wire.PRIVMSG, this.nick + '!' + to + '!' + this.identity.signPrivmsg(command, data));
  }

  private async readLoop(): Promise<void> {
    let errors = 0;
    try {
      while (this.phase === 'ready' && this.stream) {
        const line = await this.stream.readLine();
        if (this.phase !== 'ready') return;
        if (line === null) throw problem();
        if (typeof line !== 'string' || byteLength(line) > Wire.MAX_FRAME_LENGTH) throw problem('Directory frame too large');
        let frame: Wire.Frame;
        try {
          frame = this.parse(line);
        } catch {
          if (++errors >= 5) throw problem('Unreadable directory frames');
          continue;
        }
        errors = 0;
        if (frame.type === Wire.PING) await this.sendFrame(Wire.PONG, '');
        else if (frame.type === Wire.PONG) continue;
        else if (frame.type === Wire.PEERLIST) this.onPeerlist(frame.line);
        else if (
          [Wire.HANDSHAKE, Wire.DN_HANDSHAKE, Wire.NICK_AUTH_CHALLENGE, Wire.NICK_AUTH_PROOF, Wire.NICK_AUTH_RESULT].includes(frame.type)
        )
          throw problem('Out-of-order directory authentication');
        else this.enqueue(frame);
      }
    } finally {
      this.close();
    }
  }

  private enqueue(frame: Wire.Frame): void {
    if (this.receiver) {
      this.receiver.finish(frame);
      return;
    }
    const bytes = byteLength(frame.line) + 32;
    if (this.frames.length >= MAX_QUEUE || this.queuedBytes + bytes > MAX_BYTES) throw problem('Directory receive buffer full');
    this.frames.push({ frame, bytes });
    this.queuedBytes += bytes;
  }

  async receive(timeout = 60_000): Promise<Wire.Frame | null> {
    this.ready();
    if (!Number.isSafeInteger(timeout) || timeout < 0 || timeout > 120_000) throw problem('Invalid receive timeout');
    if (this.receiver) throw problem('Directory receive already pending');
    const next = this.frames.shift();
    if (next) {
      this.queuedBytes -= next.bytes;
      return next.frame;
    }
    if (timeout === 0) return null;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.receiver?.finish(null), timeout);
      const receiver = {
        finish: (frame: Wire.Frame | null, error?: DirectoryError) => {
          if (this.receiver !== receiver) return;
          clearTimeout(timer);
          this.receiver = undefined;
          if (error) reject(error);
          else resolve(frame);
        },
      };
      this.receiver = receiver;
    });
  }

  private updatePeers(map: Map<string, Peer>, entries: readonly Entry[], size: number): number {
    for (const { peer, left } of entries) {
      const previous = map.get(peer.nick);
      if (previous) size -= peerBytes(previous);
      if (left) {
        map.delete(peer.nick);
        continue;
      }
      const merged = Object.freeze({
        ...peer,
        features: Object.freeze([...new Set([...(previous?.features ?? []), ...peer.features])].slice(0, 64)),
      });
      size += peerBytes(merged);
      if ((!previous && map.size >= MAX_PEERS) || size > MAX_BYTES) throw problem('Directory peer limit exceeded');
      map.set(peer.nick, merged);
    }
    return size;
  }

  private onPeerlist(line: string): void {
    const entries = parsePeerlist(line);
    this.peerSize = this.updatePeers(this.peerMap, entries, this.peerSize);
    const collector = this.collector;
    if (!collector) return;
    if (++collector.frames > MAX_QUEUE) throw problem('Too many peer list chunks');
    const merged = entries.map(entry => ({ ...entry, peer: this.peerMap.get(entry.peer.nick) ?? entry.peer }));
    collector.bytes = this.updatePeers(collector.peers, merged, collector.bytes);
    collector.received = true;
    clearTimeout(collector.timer);
    collector.timer = setTimeout(() => collector.finish(), Math.max(0, Math.min(this.timings.quiet, collector.deadline - this.now())));
  }

  /** First response plus chunks until quiet, bounded by an absolute deadline; once per minute. */
  async getPeerlist(): Promise<readonly Peer[] | null> {
    this.ready();
    if (this.collector || this.now() - this.lastPeerlist < PEERLIST_INTERVAL) return null;
    this.lastPeerlist = this.now();
    const first = this.features.includes('peerlist_features') ? this.timings.peerlist : this.timings.connect;
    const collected = new Promise<readonly Peer[] | null>((resolve, reject) => {
      const collector: Collector = {
        peers: new Map(),
        bytes: 0,
        frames: 0,
        received: false,
        deadline: this.now() + first + this.timings.quiet,
        timer: setTimeout(() => collector.finish(), first),
        finish: error => {
          if (this.collector !== collector) return;
          clearTimeout(collector.timer);
          this.collector = undefined;
          if (error) reject(error);
          else resolve(collector.received ? Object.freeze([...collector.peers.values()]) : null);
        },
      };
      this.collector = collector;
    });
    const [, result] = await Promise.all([this.sendFrame(Wire.GETPEERLIST, ''), collected]);
    return result;
  }

  close(): void {
    if (this.phase === 'closed') return;
    this.phase = 'closed';
    this.abort.abort();
    this.detachAbort?.();
    this.detachAbort = undefined;
    const stream = this.stream;
    this.stream = undefined;
    if (stream) closeStream(stream);
    for (const cancel of [...this.waiters]) cancel(problem());
    this.receiver?.finish(null, problem());
    this.collector?.finish(problem());
    this.frames = [];
    this.queuedBytes = 0;
    this.peerMap.clear();
    this.peerSize = 0;
    // The identity is caller-owned; closing transport must not destroy it.
  }
}
