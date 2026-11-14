/**
 * Disposable real Fulcrum + authenticated TLS transport fixture.
 * Only mainnet checkpoint/height presentation is adapted for low regtest heights.
 * Transaction bytes and broadcast requests pass unchanged to the real indexer.
 */
import assert from 'assert';
import { ChildProcess, spawn } from 'child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import net from 'net';
import tls from 'tls';
import { tmpdir } from 'os';
import path from 'path';
import { XBT_MAINNET_CHECKPOINT_HEADER } from '../../class/xbt/electrum-checkpoint';

const ElectrumClient = require('electrum-client');

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

export class StandardHardwareElectrumFixture {
  directory = mkdtempSync(path.join(tmpdir(), 'redwallet-standard-electrum-'));
  private child?: ChildProcess;
  private bridge?: tls.Server;
  private sockets = new Set<net.Socket>();
  private fulcrumPort = 0;
  private stderr = '';
  port = 0;
  tipFailure = false;
  readonly counts: Record<string, number> = {};
  readonly broadcasts: string[] = [];
  tlsConnections = 0;
  checkpointRequests = 0;
  cleanupComplete = false;
  readonly ca = readFileSync(path.join(process.cwd(), 'tests/fixtures/tls/ca.pem'), 'utf8');

  private offset: number;
  constructor(offset: number) {
    this.offset = offset;
  }

  async start(binary: string, node: { directory: string; port: number; rpc(method: string): Promise<any> }) {
    this.fulcrumPort = await freePort();
    const config = path.join(this.directory, 'fulcrum.conf');
    mkdirSync(path.join(this.directory, 'db'));
    writeFileSync(config, 'allow_extended_headers = true\npolltime = 1\n');
    this.child = spawn(
      binary,
      [
        '-D',
        path.join(this.directory, 'db'),
        '-b',
        '127.0.0.1:' + node.port,
        '-K',
        path.join(node.directory, 'regtest/.cookie'),
        '-t',
        '127.0.0.1:' + this.fulcrumPort,
        config,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const capture = (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-8000);
    };
    this.child.stdout?.on('data', capture);
    this.child.stderr?.on('data', capture);
    const height = await node.rpc('getblockcount');
    const deadline = Date.now() + 60000;
    let ready = false;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) throw new Error('Fulcrum exited: ' + this.stderr);
      const client = new ElectrumClient(net, tls, this.fulcrumPort, '127.0.0.1', 'tcp');
      client.onError = () => {};
      try {
        await client.connect();
        await client.server_version('RedWallet-disposable-test', '1.4');
        ready = (await client.blockchainHeaders_subscribe()).height === height;
      } catch {
      } finally {
        client.close();
      }
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(ready, 'Fulcrum indexing timed out: ' + this.stderr);
    this.bridge = tls.createServer(
      {
        key: readFileSync(path.join(process.cwd(), 'tests/fixtures/tls/server.key')),
        cert: readFileSync(path.join(process.cwd(), 'tests/fixtures/tls/native.pem')),
      },
      socket => {
        this.tlsConnections++;
        const upstream = net.connect(this.fulcrumPort, '127.0.0.1');
        this.sockets.add(socket);
        this.sockets.add(upstream);
        const consume = (stream: net.Socket, receive: (message: any) => void) => {
          let buffer = '';
          stream.on('data', data => {
            buffer += data.toString();
            if (buffer.length > 8_000_000) return stream.destroy();
            while (buffer.includes('\n')) {
              const at = buffer.indexOf('\n');
              const line = buffer.slice(0, at);
              buffer = buffer.slice(at + 1);
              try {
                receive(JSON.parse(line));
              } catch {
                stream.destroy();
                return;
              }
            }
          });
        };
        consume(socket, message => {
          for (const request of Array.isArray(message) ? message : [message]) {
            if (typeof request.method !== 'string' || !Array.isArray(request.params)) throw new Error('Invalid fixture request');
            if (request.method === 'blockchain.block.header' && request.params[0] === 961640) {
              this.checkpointRequests++;
              socket.write(JSON.stringify({ id: request.id, result: XBT_MAINNET_CHECKPOINT_HEADER }) + '\n');
            } else if (this.tipFailure && request.method === 'blockchain.headers.subscribe') {
              socket.write(JSON.stringify({ id: request.id, error: { code: 1, message: 'fixture tip unavailable' } }) + '\n');
            } else {
              this.counts[request.method] = (this.counts[request.method] || 0) + 1;
              if (request.method === 'blockchain.transaction.broadcast') this.broadcasts.push(request.params[0]);
              // Preserve each complete request, including raw transaction bytes.
              upstream.write(JSON.stringify(request) + '\n');
            }
          }
        });
        consume(upstream, message => {
          const translate = (value: any): void => {
            if (!value || typeof value !== 'object') return;
            if (Number.isSafeInteger(value.height) && value.height > 0) value.height += this.offset;
            for (const child of Object.values(value)) translate(child);
          };
          translate(message);
          socket.write(JSON.stringify(message) + '\n');
        });
        socket.on('error', () => upstream.destroy());
        upstream.on('error', () => socket.destroy());
        upstream.on('close', () => socket.destroy());
        socket.on('close', () => {
          upstream.destroy();
          this.sockets.delete(socket);
          this.sockets.delete(upstream);
        });
      },
    );
    this.bridge.on('tlsClientError', () => {});
    // Include sockets that fail TLS authentication so cleanup is always bounded.
    this.bridge.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      this.bridge!.once('error', reject);
      this.bridge!.listen(0, '127.0.0.1', resolve);
    });
    this.port = (this.bridge.address() as net.AddressInfo).port;
  }

  disconnect() {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async stop() {
    this.disconnect();
    if (this.bridge) await new Promise<void>(resolve => this.bridge!.close(() => resolve()));
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      const child = this.child;
      await new Promise<void>((resolve, reject) => {
        const kill = setTimeout(() => child.kill('SIGKILL'), 5000);
        const deadline = setTimeout(() => reject(new Error('Fulcrum cleanup timed out')), 15000);
        child.once('exit', () => {
          clearTimeout(kill);
          clearTimeout(deadline);
          resolve();
        });
        child.kill('SIGTERM');
      });
    }
    rmSync(this.directory, { recursive: true, force: true });
    this.cleanupComplete = true;
  }
}
