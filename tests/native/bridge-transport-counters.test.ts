import { readFileSync } from 'fs';
import net from 'net';
import path from 'path';
import tls from 'tls';
import { countTransportStages, TransportCounters } from './knots-fulcrum-harness';

// Loopback-only. Distinguishes "never reached the listener", "TCP accepted but TLS never
// completed" and "TLS failed" using counts alone, with no payloads or peer details.
const fixture = (name: string) => readFileSync(path.join(process.cwd(), 'tests/fixtures/tls', name));
const settle = () => new Promise(resolve => setTimeout(resolve, 200));

describe('bridge transport counters', () => {
  let server: tls.Server;
  let counters: TransportCounters;
  let port: number;
  const sockets = new Set<net.Socket>();

  beforeEach(async () => {
    counters = { tcpAccepted: 0, tlsHandshakesCompleted: 0, tlsClientErrors: 0 };
    server = tls.createServer({ key: fixture('server.key'), cert: fixture('native.pem') }, socket => socket.on('error', () => {}));
    server.on('connection', socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    countTransportStages(server, counters);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as net.AddressInfo).port;
  });

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  test('reports zero for every stage before any client connects', async () => {
    await settle();
    expect(counters).toEqual({ tcpAccepted: 0, tlsHandshakesCompleted: 0, tlsClientErrors: 0 });
  });

  test('counts an idle TCP connection as accepted without a handshake', async () => {
    const idle = net.connect(port, '127.0.0.1');
    await new Promise<void>(resolve => idle.once('connect', () => resolve()));
    await settle();
    expect(counters).toEqual({ tcpAccepted: 1, tlsHandshakesCompleted: 0, tlsClientErrors: 0 });
    idle.destroy();
  });

  test('counts a completed handshake for a client that trusts the fixture CA', async () => {
    const secure = tls.connect({ host: '127.0.0.1', port, ca: fixture('ca.pem') });
    await new Promise<void>((resolve, reject) => {
      secure.once('secureConnect', () => resolve());
      secure.once('error', reject);
    });
    await settle();
    expect(secure.authorized).toBe(true);
    expect(counters).toEqual({ tcpAccepted: 1, tlsHandshakesCompleted: 1, tlsClientErrors: 0 });
    secure.destroy();
  });

  test('counts a TLS client error when the peer sends non-TLS bytes', async () => {
    const garbage = net.connect(port, '127.0.0.1');
    await new Promise<void>(resolve => garbage.once('connect', () => resolve()));
    garbage.on('error', () => {});
    garbage.write('not a tls client hello\r\n\r\n');
    await settle();
    expect(counters).toEqual({ tcpAccepted: 1, tlsHandshakesCompleted: 0, tlsClientErrors: 1 });
    garbage.destroy();
  });

  test('exposes only numeric counts and no payload or peer details', async () => {
    const secure = tls.connect({ host: '127.0.0.1', port, ca: fixture('ca.pem') });
    await new Promise<void>(resolve => secure.once('secureConnect', () => resolve()));
    secure.write('{"id":1,"method":"server.version","params":[]}\n');
    await settle();
    expect(Object.keys(counters).sort()).toEqual(['tcpAccepted', 'tlsClientErrors', 'tlsHandshakesCompleted']);
    expect(Object.values(counters).every(value => Number.isInteger(value))).toBe(true);
    expect(JSON.stringify(counters)).not.toMatch(/127\.0\.0\.1|server\.version/);
    secure.destroy();
  });
});
