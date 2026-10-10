import { test } from 'node:test';
import assert from 'node:assert/strict';
import tls from 'node:tls';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createRelay } from './relay.mjs';
import { parseLease } from './lease-reader.mjs';

const grant = overrides => ({ active: true, deadline_ms: BigInt(Date.now() + 60000),
  ios_published: false, android_published: false, ...overrides });

test('strict lease parsing rejects malformed state', () => {
  assert.equal(parseLease([{ ...grant(), deadline_ms: '123' }]).deadline_ms, 123n);
  for (const value of [{}, [], grant({ active: 'true' }), grant({ deadline_ms: '-1' }),
    grant({ android_published: undefined })]) assert.throws(() => parseLease(value));
});

test('TLS relay forwards and disconnects existing clients on retirement or lookup failure', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'redwallet-relay-test-'));
  let upstream;
  let relay;
  const sockets = [];
  try {
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', join(dir, 'key.pem'), '-out', join(dir, 'cert.pem'), '-days', '1',
      '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    const key = readFileSync(join(dir, 'key.pem'));
    const cert = readFileSync(join(dir, 'cert.pem'));
    upstream = tls.createServer({ key, cert }, socket => {
      sockets.push(socket); socket.on('error', () => {}); socket.pipe(socket);
    });
    await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
    let state = grant();
    let fail = false;
    relay = createRelay({ key, cert, upstream: { host: '127.0.0.1',
      port: upstream.address().port, servername: 'localhost', ca: cert },
      readLease: async () => { if (fail) throw new Error('Unavailable'); return state; } });
    const address = await relay.start();
    async function connect() {
      const socket = tls.connect({ host: '127.0.0.1', port: address.port, ca: cert, servername: 'localhost' });
      sockets.push(socket); socket.on('error', () => {});
      await once(socket, 'secureConnect');
      return socket;
    }
    let client = await connect();
    const response = once(client, 'data');
    client.write('{"id":1,"method":"server.version"}\n');
    assert.equal((await response)[0].toString(), '{"id":1,"method":"server.version"}\n');
    state = grant({ ios_published: true });
    await relay.refresh();
    assert.equal(client.destroyed, false); // One public platform alone does not expire the relay.
    let closed = once(client, 'close');
    state = grant({ ios_published: true, android_published: true });
    await relay.refresh(); await closed;
    state = grant(); await relay.refresh();
    client = await connect(); closed = once(client, 'close');
    fail = true; await relay.refresh(); await closed;
    fail = false; state = grant(); await relay.refresh();
    client = await connect(); closed = once(client, 'close');
    state = grant({ deadline_ms: BigInt(Date.now() - 1) });
    await relay.refresh(); await closed;
    state = grant(); await relay.refresh();
    client = await connect(); closed = once(client, 'close');
    state = grant({ active: false }); await relay.refresh(); await closed;
  } finally {
    for (const socket of sockets) socket.destroy();
    if (relay) await relay.close();
    if (upstream?.listening) await new Promise(resolve => upstream.close(resolve));
    rmSync(dir, { recursive: true, force: true });
  }
});

test('inactive, malformed and hung lease readers cannot start listening', async () => {
  for (const readLease of [async () => grant({ active: false }), async () => ({}),
    async () => new Promise(() => {})]) {
    const relay = createRelay({ readLease, leaseTimeoutMs: 20 });
    await assert.rejects(relay.start(), /No active/);
    assert.equal(relay.server.listening, false);
    await relay.close();
  }
});
