import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { createLeaseReader } from './lease-reader.mjs';

export function createRelay({ readLease, key, cert, upstream, listenHost = '127.0.0.1',
  listenPort = 0, pollMs = 30000, freshnessMs = 45000, maxClients = 16,
  maxClientsPerIp = 2, idleMs = 60000, maxSessionMs = 900000,
  leaseTimeoutMs = 15000 }) {
  let deadline = 0n;
  let refreshedAt = 0;
  let enabled = false;
  let closed = false;
  let timer;
  let refreshing;
  const clients = new Set();
  const perIp = new Map();
  // Monotonic freshness: rolling back the relay's wall clock cannot extend a cached grant.
  const monotonicMs = () => Number(process.hrtime.bigint() / 1000000n);
  const allowed = () => enabled && !closed &&
    monotonicMs() - refreshedAt < freshnessMs && BigInt(Date.now()) * 1000000n < deadline;
  const disconnect = () => { for (const socket of clients) socket.destroy(); };

  const server = tls.createServer({ key, cert, minVersion: 'TLSv1.2', handshakeTimeout: 5000 }, socket => {
    if (!allowed()) { socket.destroy(); return; }
    const address = socket.remoteAddress;
    // Counts use the TCP connection event below, including incomplete TLS handshakes.
    if ((perIp.get(address) ?? 0) > maxClientsPerIp) { socket.destroy(); return; }
    let backend;
    try {
      backend = tls.connect({ host: upstream.host, port: upstream.port,
        servername: upstream.servername ?? upstream.host, rejectUnauthorized: true,
        ...(upstream.ca ? { ca: upstream.ca } : {}), minVersion: 'TLSv1.2' });
    } catch { socket.destroy(); return; }
    backend.setTimeout(idleMs, () => backend.destroy());
    socket.setTimeout(idleMs, () => socket.destroy());
    backend.on('error', () => socket.destroy());
    socket.on('error', () => backend.destroy());
    socket.on('close', () => backend.destroy());
    backend.on('close', () => socket.destroy());
    backend.once('secureConnect', () => {
      if (!allowed()) { socket.destroy(); backend.destroy(); return; }
      socket.pipe(backend).pipe(socket);
    });
  });
  server.on('tlsClientError', () => {}); // Do not log peer addresses or wallet traffic.
  server.on('connection', socket => {
    const address = socket.remoteAddress;
    if (!allowed() || clients.size >= maxClients || (perIp.get(address) ?? 0) >= maxClientsPerIp) {
      socket.destroy(); return;
    }
    clients.add(socket);
    perIp.set(address, (perIp.get(address) ?? 0) + 1);
    const session = setTimeout(() => socket.destroy(), maxSessionMs);
    socket.on('error', () => {});
    socket.once('close', () => {
      clearTimeout(session);
      clients.delete(socket);
      const remaining = (perIp.get(address) ?? 1) - 1;
      if (remaining > 0) perIp.set(address, remaining); else perIp.delete(address);
    });
  });

  async function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      let timeout;
      try {
        const lease = await Promise.race([readLease(), new Promise((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Lease timeout')), leaseTimeoutMs);
        })]);
        if (closed) return;
        if (typeof lease.active !== 'boolean' || typeof lease.ios_published !== 'boolean' ||
            typeof lease.android_published !== 'boolean' ||
            !/^[0-9]+$/.test(String(lease.deadline_ms))) throw new Error('Invalid lease');
        deadline = BigInt(lease.deadline_ms) * 1000000n;
        enabled = lease.active && !(lease.ios_published && lease.android_published);
        refreshedAt = monotonicMs();
      } catch { enabled = false; }
      finally { clearTimeout(timeout); }
      if (!allowed()) disconnect();
    })().finally(() => { refreshing = undefined; });
    return refreshing;
  }

  return {
    server, refresh,
    async start() {
      await refresh();
      if (!allowed()) throw new Error('No active certified ICP lease');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(listenPort, listenHost, () => { server.removeListener('error', reject); resolve(); });
      });
      let nextPoll = monotonicMs() + pollMs;
      timer = setInterval(() => {
        if (!allowed()) disconnect();
        if (monotonicMs() >= nextPoll) { nextPoll = monotonicMs() + pollMs; void refresh(); }
      }, Math.min(pollMs, 1000));
      return server.address();
    },
    async close() {
      closed = true; enabled = false; clearInterval(timer); disconnect();
      if (server.listening) await new Promise(resolve => server.close(resolve));
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  for (const name of ['ICP_CANISTER_ID', 'TLS_KEY_FILE', 'TLS_CERT_FILE', 'FULCRUM_HOST', 'FULCRUM_PORT'])
    if (!env[name]) throw new Error('Missing ' + name);
  const port = Number(env.FULCRUM_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid upstream port');
  const relay = createRelay({
    readLease: createLeaseReader({ canisterId: env.ICP_CANISTER_ID, cwd: import.meta.dirname }),
    key: readFileSync(env.TLS_KEY_FILE), cert: readFileSync(env.TLS_CERT_FILE),
    upstream: { host: env.FULCRUM_HOST, port, servername: env.FULCRUM_TLS_NAME || env.FULCRUM_HOST },
    listenHost: env.LISTEN_HOST || '127.0.0.1', listenPort: Number(env.LISTEN_PORT || '50002'),
  });
  await relay.start();
  console.log('Temporary testing relay active');
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await relay.close(); });
}
