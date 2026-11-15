import { createIosDirectoryTransport } from '../../class/joinblaket/ios-transport';
import {
  DirectoryClient,
  DirectoryLineStream,
  DirectoryTransport,
  DIRECTORY_HOST,
  DIRECTORY_ID,
  DIRECTORY_PORT,
  parsePeerlist,
} from '../../class/joinblaket/directory';
import { NickIdentity, verifyPrivmsg, verifyProof } from '../../class/joinblaket/nick';
import * as Wire from '../../class/joinblaket/wire';

jest.mock('../../class/rng', () => ({ randomBytes: jest.fn(async (size: number) => Buffer.alloc(size, 7)) }));

function deferred<T>() {
  let resolveValue!: (value: T) => void;
  const promise = new Promise<T>(resolve => {
    resolveValue = resolve;
  });
  return { promise, resolve: resolveValue };
}
async function turns(count = 15) {
  for (let i = 0; i < count; i++) await Promise.resolve();
}

class Stream implements DirectoryLineStream {
  lines: Array<string | null> = [];
  pending?: (line: string | null) => void;
  writes: string[] = [];
  closes = 0;
  closed = false;
  onWrite: (frame: Wire.Frame) => Promise<void> = async () => {};
  async readLine() {
    if (this.closed) return null;
    if (this.lines.length) return this.lines.shift()!;
    return new Promise<string | null>(resolve => {
      this.pending = resolve;
    });
  }

  async writeLine(line: string) {
    this.writes.push(line);
    await this.onWrite(Wire.parse(line));
  }

  push(line: string | null) {
    if (this.pending) {
      const pending = this.pending;
      this.pending = undefined;
      pending(line);
    } else this.lines.push(line);
  }

  frame(type: number, line: string) {
    this.push(Wire.envelope(type, line));
  }

  close() {
    this.closes++;
    this.closed = true;
    this.pending?.(null);
    this.pending = undefined;
  }
}
const challenge = { challenge: 'a'.repeat(64), directoryId: DIRECTORY_ID };
function reply(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    accepted: true,
    network: 'xbt',
    'proto-ver': 5,
    features: { nick_auth: true, peerlist_features: true, ping: true },
    ...overrides,
  });
}
function challengeLine(id = DIRECTORY_ID) {
  return JSON.stringify({ challenge: challenge.challenge, 'directory-id': id });
}
const clients: DirectoryClient[] = [];
const identities: NickIdentity[] = [];
function fixture(timeouts = {}) {
  const identity = new NickIdentity(Buffer.alloc(32, 1));
  identities.push(identity);
  const stream = new Stream();
  let hello = '',
    proofValid = false;
  stream.onWrite = async frame => {
    if (frame.type === Wire.HANDSHAKE) {
      hello = frame.line;
      stream.frame(Wire.DN_HANDSHAKE, reply());
      stream.frame(Wire.NICK_AUTH_CHALLENGE, challengeLine());
    } else if (frame.type === Wire.NICK_AUTH_PROOF) {
      proofValid = verifyProof(frame.line, challenge, DIRECTORY_ID, hello, identity.nick);
      stream.frame(Wire.NICK_AUTH_RESULT, JSON.stringify({ code: 'ok', verified: true }));
    }
  };
  const open = jest.fn(async () => stream);
  const transport: DirectoryTransport = { viaTor: true, open };
  const client = new DirectoryClient({ identity, transport, timeouts, now: () => Date.now() });
  clients.push(client);
  return { identity, stream, client, transport, open, proofValid: () => proofValid };
}
afterEach(() => {
  clients.splice(0).forEach(c => c.close());
  identities.splice(0).forEach(id => id.destroy());
  jest.useRealTimers();
});

it('pins the Tor endpoint, verifies the challenge transcript and sends CRLF-compatible lines', async () => {
  const f = fixture();
  await f.client.connect();
  expect(f.open).toHaveBeenCalledWith(DIRECTORY_HOST, DIRECTORY_PORT, expect.any(AbortSignal));
  expect(f.proofValid()).toBe(true);
  expect(f.client.authenticated).toBe(true);
  expect(f.client.directoryFeatures).toContain('nick_auth');
  expect(f.stream.writes.every(line => line.endsWith('\r') && !line.includes('\n'))).toBe(true);
});

it('refuses non-Tor adapters and invalid timeout settings before opening', () => {
  const f = fixture();
  expect(
    () => new DirectoryClient({ identity: f.identity, transport: { ...f.transport, viaTor: false } as unknown as DirectoryTransport }),
  ).toThrow('Tor');
  for (const connect of [0, -1, 120001, NaN, 1.5]) {
    expect(() => new DirectoryClient({ identity: f.identity, transport: f.transport, timeouts: { connect } })).toThrow('timeout');
  }
  expect(f.open).not.toHaveBeenCalled();
});

it('blocks all application traffic before authentication and allows only one connect', async () => {
  const f = fixture();
  await expect(f.client.sendPublic('!orderbook')).rejects.toThrow('authenticated');
  await expect(f.client.sendPrivate(f.identity.nick, 'fill', 'x')).rejects.toThrow('authenticated');
  await expect(f.client.receive(0)).rejects.toThrow('authenticated');
  await expect(f.client.getPeerlist()).rejects.toThrow('authenticated');
  const connecting = f.client.connect();
  await expect(f.client.connect()).rejects.toThrow('once');
  await connecting;
  await expect(f.client.connect()).rejects.toThrow('once');
});

it.each([
  reply({ network: 'btc' }),
  reply({ features: { nick_auth: false } }),
  reply({ accepted: 'true' }),
  reply({ 'proto-ver': 1 }),
  '{"accepted":false,"accepted":true,"network":"xbt","features":{"nick_auth":true}}',
])('refuses an incompatible or ambiguous handshake (%#)', async line => {
  const f = fixture();
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.HANDSHAKE) f.stream.frame(Wire.DN_HANDSHAKE, line);
  };
  await expect(f.client.connect()).rejects.toThrow();
  expect(f.stream.writes).toHaveLength(1);
  expect(f.client.authenticated).toBe(false);
  expect(f.stream.closed).toBe(true);
});

it('refuses another directory identity without sending a proof', async () => {
  const f = fixture();
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.HANDSHAKE) {
      f.stream.frame(Wire.DN_HANDSHAKE, reply());
      f.stream.frame(Wire.NICK_AUTH_CHALLENGE, challengeLine('other.onion:5222'));
    }
  };
  await expect(f.client.connect()).rejects.toThrow('identity mismatch');
  expect(f.stream.writes).toHaveLength(1);
  expect(f.identity.destroyed).toBe(false);
});

it.each([Wire.NICK_AUTH_RESULT, Wire.PRIVMSG, Wire.NICK_AUTH_PROOF])('rejects out-of-order challenge type %i', async type => {
  const f = fixture();
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.HANDSHAKE) {
      f.stream.frame(Wire.DN_HANDSHAKE, reply());
      f.stream.frame(type, challengeLine());
    }
  };
  await expect(f.client.connect()).rejects.toThrow('Out-of-order');
});

it('answers ping during authentication without exposing it to receive', async () => {
  const f = fixture(),
    normal = f.stream.onWrite;
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.HANDSHAKE) f.stream.frame(Wire.PING, '');
    await normal(frame);
  };
  await f.client.connect();
  expect(f.stream.writes.map(Wire.parse).some(frame => frame.type === Wire.PONG)).toBe(true);
  expect(await f.client.receive(0)).toBeNull();
});

it('bounds a handshake flooded with valid control frames', async () => {
  const f = fixture();
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.HANDSHAKE) for (let i = 0; i < 33; i++) f.stream.frame(Wire.PING, '');
  };
  await expect(f.client.connect()).rejects.toThrow('Too many');
  expect(f.stream.closed).toBe(true);
});

it('times out a silent opening and closes a stream that arrives late', async () => {
  jest.useFakeTimers();
  const f = fixture({ connect: 10 }),
    opening = deferred<Stream>();
  f.open.mockReturnValue(opening.promise);
  const connecting = f.client.connect();
  await Promise.all([expect(connecting).rejects.toThrow('timed out'), jest.advanceTimersByTimeAsync(11)]);
  opening.resolve(f.stream);
  await turns();
  expect(f.stream.closed).toBe(true);
  expect(f.stream.writes).toHaveLength(0);
});

it('aborts opening and retains ownership of the caller identity', async () => {
  const f = fixture(),
    opening = deferred<Stream>(),
    abort = new AbortController();
  f.open.mockReturnValue(opening.promise);
  const connecting = f.client.connect(abort.signal);
  abort.abort();
  await expect(connecting).rejects.toThrow('closed');
  opening.resolve(f.stream);
  await turns();
  expect(f.stream.closed).toBe(true);
  expect(f.identity.destroyed).toBe(false);
  await expect(f.client.connect()).rejects.toThrow('once');
});

it('rejects an already-aborted request without touching the transport', async () => {
  const f = fixture(),
    abort = new AbortController();
  abort.abort();
  await expect(f.client.connect(abort.signal)).rejects.toThrow();
  expect(f.open).not.toHaveBeenCalled();
});

it('bounds the wait for a missing auth result', async () => {
  jest.useFakeTimers();
  const f = fixture({ auth: 10 }),
    normal = f.stream.onWrite;
  f.stream.onWrite = async frame => {
    if (frame.type !== Wire.NICK_AUTH_PROOF) await normal(frame);
  };
  const connecting = f.client.connect();
  await Promise.all([expect(connecting).rejects.toThrow('timed out'), jest.advanceTimersByTimeAsync(11)]);
});

it('serializes concurrent writes and signs private messages for the right recipient', async () => {
  const f = fixture();
  await f.client.connect();
  const blocked = deferred<void>();
  f.stream.onWrite = async frame => {
    if (frame.line.endsWith('!first')) await blocked.promise;
  };
  const first = f.client.sendPublic('!first'),
    second = f.client.sendPrivate(f.identity.nick, 'fill', 'payload');
  await turns();
  expect(f.stream.writes).toHaveLength(3);
  blocked.resolve();
  await Promise.all([first, second]);
  const last = Wire.parse(f.stream.writes[3]);
  const [from, to, rest] = last.line.split('!');
  expect(from).toBe(f.identity.nick);
  expect(to).toBe(f.identity.nick);
  expect(verifyPrivmsg(from, rest)).toMatchObject({ ok: true, command: 'fill', data: 'payload' });
});

it('closing settles both active and queued writes and a pending receive', async () => {
  const f = fixture();
  await f.client.connect();
  f.stream.onWrite = () => new Promise(() => {});
  const work = [f.client.sendPublic('!one'), f.client.sendPublic('!two'), f.client.receive()];
  const settled = Promise.allSettled(work);
  await turns();
  f.client.close();
  expect((await settled).every(result => result.status === 'rejected')).toBe(true);
  expect(f.identity.destroyed).toBe(false);
});

it('handles receive timeout without disconnecting and refuses concurrent consumers', async () => {
  jest.useFakeTimers();
  const f = fixture();
  await f.client.connect();
  const waiting = f.client.receive(10);
  await expect(f.client.receive(10)).rejects.toThrow('already pending');
  await Promise.all([expect(waiting).resolves.toBeNull(), jest.advanceTimersByTimeAsync(10)]);
  f.stream.frame(Wire.PRIVMSG, 'application');
  await turns();
  expect(await f.client.receive(0)).toEqual({ type: Wire.PRIVMSG, line: 'application' });
  expect(f.client.isConnected).toBe(true);
});

it.each([Wire.HANDSHAKE, Wire.DN_HANDSHAKE, Wire.NICK_AUTH_CHALLENGE, Wire.NICK_AUTH_PROOF, Wire.NICK_AUTH_RESULT])(
  'closes on authentication replay type %i',
  async type => {
    const f = fixture();
    await f.client.connect();
    f.stream.frame(type, '{}');
    await turns();
    expect(f.client.authenticated).toBe(false);
    await expect(f.client.receive(0)).rejects.toThrow();
  },
);

it('tolerates four malformed frames, resets on a good frame and closes on the fifth consecutive error', async () => {
  const f = fixture();
  await f.client.connect();
  for (let i = 0; i < 4; i++) f.stream.push('bad');
  f.stream.frame(Wire.PONG, '');
  for (let i = 0; i < 4; i++) f.stream.push('bad');
  await turns(40);
  expect(f.client.isConnected).toBe(true);
  f.stream.push('bad');
  await turns();
  expect(f.client.isConnected).toBe(false);
});

it('rejects oversized received frames immediately', async () => {
  const f = fixture();
  await f.client.connect();
  f.stream.push('é'.repeat(32769));
  await turns();
  expect(f.stream.closed).toBe(true);
});

it('bounds the frame count of unread application traffic', async () => {
  const f = fixture();
  await f.client.connect();
  for (let i = 0; i < 1025; i++) f.stream.frame(Wire.PRIVMSG, 'x');
  await turns(4000);
  expect(f.client.isConnected).toBe(false);
});

it('bounds bytes of unread application traffic independently of frame count', async () => {
  const f = fixture();
  await f.client.connect();
  for (let i = 0; i < 142; i++) f.stream.frame(Wire.PRIVMSG, 'x'.repeat(60000));
  await turns(600);
  expect(f.client.isConnected).toBe(false);
});

it('parses peer removals and skips malformed fields/features', () => {
  const parsed = parsePeerlist('metadata,good;host:1;F:a+b,leave;host:2;D,bad nick;host,a;bad!host,long;host;F:' + 'x'.repeat(65));
  expect(parsed.map(e => e.peer.nick)).toEqual(['good', 'leave']);
  expect(parsed[0].peer.features).toEqual(['a', 'b']);
  expect(parsed[1].left).toBe(true);
});

it('merges peer capabilities, returns an isolated map and removes departed peers', async () => {
  const f = fixture();
  await f.client.connect();
  f.stream.frame(Wire.PEERLIST, 'maker;host;F:a');
  f.stream.frame(Wire.PEERLIST, 'maker;host;F:b');
  await turns();
  const snapshot = f.client.peers;
  expect(snapshot.get('maker')?.features).toEqual(['a', 'b']);
  (snapshot as Map<string, unknown>).clear();
  expect(f.client.peers.size).toBe(1);
  f.stream.frame(Wire.PEERLIST, 'maker;host;D');
  await turns();
  expect(f.client.peers.size).toBe(0);
});

it('bounds the active peer count', async () => {
  const f = fixture();
  await f.client.connect();
  for (let group = 0; group < 21; group++) {
    f.stream.frame(Wire.PEERLIST, Array.from({ length: 1000 }, (_, i) => 'peer' + (group * 1000 + i) + ';host').join(','));
  }
  await turns(100);
  expect(f.client.isConnected).toBe(false);
});

it('collects chunked peers until quiet, preserves cached features and rate limits requests', async () => {
  jest.useFakeTimers();
  const f = fixture({ peerlist: 20, quiet: 5 });
  await f.client.connect();
  f.stream.frame(Wire.PEERLIST, 'a;host;F:old');
  await turns();
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.GETPEERLIST) {
      f.stream.frame(Wire.PEERLIST, 'a;host;F:new,b;host');
      f.stream.frame(Wire.PEERLIST, 'b;host;D,c;host');
    }
  };
  const collection = f.client.getPeerlist();
  await jest.advanceTimersByTimeAsync(6);
  const peers = await collection;
  expect(peers?.map(p => p.nick)).toEqual(['a', 'c']);
  expect(peers?.[0].features).toEqual(['old', 'new']);
  expect(await f.client.getPeerlist()).toBeNull();
  await jest.advanceTimersByTimeAsync(60000);
  const again = f.client.getPeerlist();
  await jest.advanceTimersByTimeAsync(6);
  expect((await again)?.length).toBe(2);
});

it('ends a silent peer list request and rejects an in-progress collection on close', async () => {
  jest.useFakeTimers();
  const f = fixture({ peerlist: 10, quiet: 5 });
  await f.client.connect();
  const collection = f.client.getPeerlist();
  await Promise.all([expect(collection).resolves.toBeNull(), jest.advanceTimersByTimeAsync(11)]);
  await jest.advanceTimersByTimeAsync(60000);
  const next = f.client.getPeerlist();
  f.client.close();
  await expect(next).rejects.toThrow('closed');
});

it('closes on EOF with a receive waiting', async () => {
  const f = fixture();
  await f.client.connect();
  const waiting = f.client.receive();
  f.stream.push(null);
  await expect(waiting).rejects.toThrow('closed');
});

it('accepts a signed encrypted-message-sized payload that fits the 64 KiB frame', async () => {
  const f = fixture();
  await f.client.connect();
  const payload = 'A'.repeat(64056); // 48,000 plaintext bytes + NaCl nonce/MAC, base64 encoded
  await f.client.sendPrivate(f.identity.nick, 'tx', payload);
  const frame = Wire.parse(f.stream.writes[f.stream.writes.length - 1]);
  const [from, , rest] = frame.line.split('!');
  expect(verifyPrivmsg(from, rest).ok).toBe(true);
});

it('times out a blocked PONG within the current handshake deadline', async () => {
  jest.useFakeTimers();
  const f = fixture({ connect: 10, write: 100 });
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.HANDSHAKE) f.stream.frame(Wire.PING, '');
    if (frame.type === Wire.PONG) await new Promise(() => {});
  };
  const connecting = f.client.connect();
  await Promise.all([expect(connecting).rejects.toThrow('timed out'), jest.advanceTimersByTimeAsync(11)]);
  expect(f.stream.closed).toBe(true);
});

it('fails closed when concurrent callers exceed the bounded write queue', async () => {
  const f = fixture();
  await f.client.connect();
  const sends = Array.from({ length: 65 }, () => f.client.sendPublic('!orderbook'));
  const results = await Promise.allSettled(sends);
  expect(results.every(r => r.status === 'rejected')).toBe(true);
  expect(f.stream.closed).toBe(true);
});

it('rejects oversized outgoing content before sending and keeps the connection usable', async () => {
  const f = fixture();
  await f.client.connect();
  await expect(f.client.sendPublic('x'.repeat(65537))).rejects.toThrow();
  await expect(f.client.sendPrivate(f.identity.nick, 'tx', 'x'.repeat(65537))).rejects.toThrow();
  await expect(f.client.sendPublic('€'.repeat(11000))).rejects.toThrow('too large');
  expect(f.stream.writes).toHaveLength(2);
  expect(f.client.isConnected).toBe(true);
});

it('does not authenticate after a refused proof', async () => {
  const f = fixture(),
    normal = f.stream.onWrite;
  f.stream.onWrite = async frame => {
    if (frame.type === Wire.NICK_AUTH_PROOF) f.stream.frame(Wire.NICK_AUTH_RESULT, '{"code":"ok","verified":false}');
    else await normal(frame);
  };
  await expect(f.client.connect()).rejects.toThrow('rejected');
  expect(f.client.authenticated).toBe(false);
});

it('does not extend peer collection indefinitely when chunks keep arriving', async () => {
  jest.useFakeTimers();
  const f = fixture({ peerlist: 20, quiet: 5 });
  await f.client.connect();
  const start = Date.now();
  let ended = -1,
    index = 0;
  const collection = f.client.getPeerlist().then(peers => {
    ended = Date.now() - start;
    return peers;
  });
  const timer = setInterval(() => f.stream.frame(Wire.PEERLIST, 'peer' + index++ + ';host'), 4);
  await jest.advanceTimersByTimeAsync(30);
  clearInterval(timer);
  expect((await collection)?.length).toBeGreaterThan(0);
  expect(ended).toBeLessThanOrEqual(25);
});

it('releases queue byte accounting when frames are consumed', async () => {
  const f = fixture();
  await f.client.connect();
  for (let batch = 0; batch < 2; batch++) {
    for (let i = 0; i < 80; i++) f.stream.frame(Wire.PRIVMSG, 'x'.repeat(60000));
    await turns(350);
    for (let i = 0; i < 80; i++) expect((await f.client.receive(0))?.type).toBe(Wire.PRIVMSG);
  }
  expect(f.client.isConnected).toBe(true);
});

it('authenticates through the native adapter contract and never opens an arbitrary destination', async () => {
  const f = fixture();
  const bridge = {
    joinblaket: jest.fn(async (action: string, _id: string, value: string) => {
      if (action === 'read') return f.stream.readLine();
      if (action === 'write') {
        await f.stream.writeLine(value);
        return null;
      }
      if (action === 'close') {
        f.stream.close();
        return null;
      }
      return null;
    }),
  };
  const client = new DirectoryClient({ identity: f.identity, transport: createIosDirectoryTransport(bridge, 'ios') });
  clients.push(client);
  await client.connect();
  expect(f.proofValid()).toBe(true);
  await client.sendPublic('!orderbook');
  expect(Wire.parse(f.stream.writes[f.stream.writes.length - 1]).line).toBe(f.identity.nick + '!PUBLIC!!orderbook');
  expect(bridge.joinblaket.mock.calls.every(([, id]) => /^[0-9a-f]{32}$/.test(id))).toBe(true);
  client.close();
  await turns();
  expect(f.stream.closed).toBe(true);
});

it('bounds write time from enqueue so preceding writes cannot extend the deadline', async () => {
  jest.useFakeTimers();
  const f = fixture({ write: 10 });
  await f.client.connect();
  const firstWrite = deferred<void>();
  f.stream.onWrite = async frame => {
    if (frame.line.endsWith('!first')) await firstWrite.promise;
    else await new Promise(() => {});
  };
  const outcomes = Promise.allSettled([f.client.sendPublic('!first'), f.client.sendPublic('!second')]);
  setTimeout(() => firstWrite.resolve(), 8);
  await jest.advanceTimersByTimeAsync(11);
  expect(f.client.isConnected).toBe(false);
  expect((await outcomes).map(r => r.status)).toEqual(['fulfilled', 'rejected']);
});
