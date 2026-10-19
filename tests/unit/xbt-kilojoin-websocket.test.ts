/** Real loopback WebSocket frames; never connects to a public relay. */
import { EventEmitter } from 'events';
import { AddressInfo } from 'net';
import { KilojoinRelay, publishIsolated, SocketFactory } from '../../class/xbt/kilojoin/relay';
import { signEvent } from '../../class/xbt/kilojoin/crypto';
// ws is supplied by the existing React Native test dependency tree. Keep this
// test-only surface explicit without adding ambient types to production code.
interface TestSocket extends EventEmitter {
  terminate(): void;
  send(data: string): void;
}
interface TestServer extends EventEmitter {
  address(): AddressInfo;
  clients: Set<TestSocket>;
  close(callback: () => void): void;
}
const NodeWebSocket = require('ws') as {
  new (url: string): WebSocket;
  Server: new (options: { host: string; port: number }) => TestServer;
};
const WebSocketServer = NodeWebSocket.Server;
const secret = Buffer.from('01'.padStart(64, '0'), 'hex');
const event = signEvent({ kind: 2023, created_at: 100, tags: [], content: 'public transport fixture' }, secret, Buffer.alloc(32));
async function fixture() {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const factory: SocketFactory = () => new NodeWebSocket(url) as unknown as WebSocket;
  return {
    server,
    factory,
    close: async () => {
      for (const socket of server.clients) socket.terminate();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
test('real socket handles positive, negative and disconnected publication acknowledgments', async () => {
  const f = await fixture();
  const errors: string[] = [];
  const relay = new KilojoinRelay(
    async () => {},
    e => errors.push(e.message),
    f.factory,
  );
  let count = 0;
  f.server.on('connection', (socket: TestSocket) =>
    socket.on('message', (bytes: Buffer) => {
      const frame = JSON.parse(bytes.toString());
      if (frame[0] !== 'EVENT') return;
      count++;
      if (count === 3) socket.terminate();
      else socket.send(JSON.stringify(['OK', frame[1].id, count === 1, 'fixture']));
    }),
  );
  try {
    await relay.connect();
    await expect(relay.publish(event)).resolves.toBeUndefined();
    await expect(relay.publish(event)).rejects.toThrow('rejected');
    await expect(relay.publish(event)).rejects.toThrow('closed');
    await expect(relay.publish(event)).rejects.toThrow('not connected');
    expect(errors).toContain('Relay disconnected');
    expect(count).toBe(3);
  } finally {
    relay.close();
    await f.close();
  }
});
test('isolated output publications use and close distinct real sockets', async () => {
  const f = await fixture();
  let connections = 0,
    closes = 0;
  f.server.on('connection', (socket: TestSocket) => {
    connections++;
    socket.on('close', () => {
      closes++;
    });
    socket.on('message', (bytes: Buffer) => {
      const frame = JSON.parse(bytes.toString());
      socket.send(JSON.stringify(['OK', frame[1].id, true]));
    });
  });
  try {
    await publishIsolated(event, f.factory);
    await publishIsolated(event, f.factory);
    expect(connections).toBe(2);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (closes === 2) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(closes).toBe(2);
  } finally {
    await f.close();
  }
});
test('real subscription changes discard frames from the obsolete subscription', async () => {
  const f = await fixture();
  const received: string[] = [];
  const relay = new KilojoinRelay(
    async e => {
      received.push(e.id);
    },
    () => {},
    f.factory,
  );
  let oldId = '',
    newId = '';
  f.server.on('connection', (socket: TestSocket) =>
    socket.on('message', (bytes: Buffer) => {
      const frame = JSON.parse(bytes.toString());
      if (frame[0] !== 'REQ') return;
      if (!oldId) oldId = frame[1];
      else {
        newId = frame[1];
        socket.send(JSON.stringify(['EVENT', oldId, event]));
        socket.send(JSON.stringify(['EVENT', newId, event]));
      }
    }),
  );
  try {
    await relay.connect();
    relay.subscribe([event.pubkey], [event.pubkey], 0);
    relay.subscribe([event.pubkey], [event.pubkey], 1);
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (newId && received.length) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(newId).not.toBe(oldId);
    expect(received).toEqual([event.id]);
  } finally {
    relay.close();
    await f.close();
  }
});
