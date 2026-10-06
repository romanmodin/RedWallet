/**
 * Disposable real Knots/Fulcrum backend. Never point this at an existing data directory.
 * Only the pinned mainnet checkpoint request is adapted for the production app.
 * All history, UTXO, transaction and broadcast traffic reaches real Fulcrum.
 */
import assert from 'assert';
import { spawn, ChildProcess, execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, readFileSync, createWriteStream, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import net from 'net';
import tls from 'tls';
import * as bitcoin from 'bitcoinjs-lib';

// Fixture address encoding needs no signing ECC. bitcoinjs-lib's P2TR payment
// wrapper does, so decode/encode the witness program directly in this driver.
export function fixtureOutputScript(address: string): Uint8Array {
  if (/^(bc1p|bcrt1p|tb1p)/i.test(address)) {
    const decoded = bitcoin.address.fromBech32(address);
    assert.equal(decoded.version, 1);
    assert.equal(decoded.data.length, 32);
    return bitcoin.script.compile([bitcoin.opcodes.OP_1, decoded.data]);
  }
  return bitcoin.address.toOutputScript(address);
}

export function fixtureAddress(script: Uint8Array, prefix = 'bc'): string {
  if (script.length === 34 && script[0] === bitcoin.opcodes.OP_1 && script[1] === 32)
    return bitcoin.address.toBech32(script.slice(2), 1, prefix);
  return bitcoin.address.fromOutputScript(script, prefix === 'bcrt' ? bitcoin.networks.regtest : bitcoin.networks.bitcoin);
}

type RpcResult = { result: any; error?: { message: string } };
type Request = { id: number | string; method: string; params: unknown[] };
export type Fault = 'none' | 'wrong-checkpoint' | 'history-timeout' | 'disconnect';
export type BackendOptions = {
  bitcoind: string;
  bitcoinCli: string;
  fulcrum: string;
  artifactDirectory?: string;
};
export type BackendReceipt = {
  schemaVersion: number;
  sourceCommit: string;
  cleanupComplete: boolean;
  chain: 'regtest';
  checkpointAdapted: true;
  blake2bHeight: number;
  binaries: Record<string, string>;
  forwardedMethods: Record<string, number>;
  fundingTxids: string[];
  disconnectFaults: number;
  checkpointRequests: number;
  invalidCertificateTested: boolean;
};

export async function eventually(check: () => Promise<boolean>, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  do {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for isolated backend' + (lastError instanceof Error ? ': ' + lastError.message : ''));
}

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

export class KnotsFulcrumHarness {
  readonly directory = mkdtempSync(path.join(tmpdir(), 'redwallet-disposable-regtest-'));

  readonly receipt: BackendReceipt;
  fault: Fault = 'none';
  private processes: ChildProcess[] = [];
  private streams: ReturnType<typeof createWriteStream>[] = [];
  private bridge?: tls.Server;
  private sockets = new Set<net.Socket>();
  private rpcPort = 0;
  private fulcrumPort = 0;
  private minerAddress = '';
  private bridgePort = 0;
  private stopped = false;

  constructor(private options: BackendOptions) {
    this.receipt = {
      schemaVersion: 1,
      sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim(),
      cleanupComplete: false,
      chain: 'regtest',
      checkpointAdapted: true,
      blake2bHeight: 150,
      binaries: Object.fromEntries(
        Object.entries(options)
          .filter(([key]) => key !== 'artifactDirectory')
          .map(([key, value]) => [key, createHash('sha256').update(readFileSync(value!)).digest('hex')]),
      ),
      forwardedMethods: {},
      fundingTxids: [],
      disconnectFaults: 0,
      checkpointRequests: 0,
      invalidCertificateTested: false,
    };
  }

  private launch(binary: string, args: string[], name: string): void {
    const stream = createWriteStream(path.join(this.directory, name + '.log'), {
      mode: 0o600,
    });
    this.streams.push(stream);
    const child = spawn(binary, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout?.pipe(stream, { end: false });
    child.stderr?.pipe(stream, { end: false });
    child.on('error', error => stream.write(error.message + '\n'));
    this.processes.push(child);
  }

  async rpc(method: string, params: unknown[] = [], wallet = false, timeout = 10_000): Promise<any> {
    // Only this harness's new temporary cookie is read, never a configured node's cookie.
    const cookie = readFileSync(path.join(this.directory, 'node/regtest/.cookie'), 'utf8').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch('http://127.0.0.1:' + this.rpcPort + (wallet ? '/wallet/public-fixture-miner' : '/'), {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(cookie).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const result = (await response.json()) as RpcResult;
      if (result.error) throw new Error('Isolated Knots ' + method + ': ' + result.error.message);
      if (!response.ok) throw new Error('Isolated Knots RPC HTTP ' + response.status);
      return result.result;
    } catch (error) {
      // Report the operation without its parameters or temporary RPC cookie.
      if (controller.signal.aborted) throw new Error(`Isolated Knots RPC ${method} exceeded ${timeout}ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async electrum(method: string, params: unknown[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      const socket = net.connect(this.fulcrumPort, '127.0.0.1');
      let buffer = '';
      let finished = false;
      const done = (error?: Error, result?: unknown) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => done(new Error('Isolated Fulcrum RPC timeout')), 10_000);
      socket.on('error', error => done(error));
      socket.on('end', () => done(new Error('Isolated Fulcrum closed before response')));
      socket.on('connect', () => socket.write(JSON.stringify({ id: 1, method, params }) + '\n'));
      socket.on('data', data => {
        buffer += data.toString();
        if (buffer.length > 8_000_000) return done(new Error('Oversized isolated Fulcrum response'));
        while (buffer.includes('\n')) {
          const index = buffer.indexOf('\n');
          let message;
          try {
            message = JSON.parse(buffer.slice(0, index));
          } catch {
            return done(new Error('Malformed isolated Fulcrum response'));
          }
          buffer = buffer.slice(index + 1);
          if (message.id !== 1) continue;
          done(message.error ? new Error(message.error.message) : undefined, message.result);
        }
      });
    });
  }

  async start(): Promise<void> {
    if (this.stopped || this.processes.length) throw new Error('Harness cannot be reused');
    mkdirSync(path.join(this.directory, 'node'));
    mkdirSync(path.join(this.directory, 'fulcrum'));
    this.rpcPort = await freePort();
    this.fulcrumPort = await freePort();
    this.launch(
      this.options.bitcoind,
      [
        '-datadir=' + path.join(this.directory, 'node'),
        '-regtest',
        '-server',
        '-txindex=1',
        '-listen=0',
        '-discover=0',
        '-dnsseed=0',
        '-connect=0',
        '-upnp=0',
        '-natpmp=0',
        '-rpcbind=127.0.0.1',
        '-rpcallowip=127.0.0.1',
        '-rpcport=' + this.rpcPort,
        '-fallbackfee=0.00001',
        '-testactivationheight=blake2b@150',
        '-blake2b_headline=RedWallet-public-regtest-only',
        '-printtoconsole=1',
        '-nodebuglogfile',
      ],
      'knots',
    );
    await eventually(async () => (await this.rpc('getblockchaininfo')).chain === 'regtest');
    // First hosted Mac wallet initialization took 22.6s in the retained receipt.
    await this.rpc('createwallet', ['public-fixture-miner'], false, 60_000);
    this.minerAddress = await this.rpc('getnewaddress', [], true);
    // Bootstrap mining is larger than ordinary RPC reads.
    // Keep it bounded; never retry a mutating timed-out RPC.
    await this.rpc('generatetoaddress', [151, this.minerAddress], false, 60_000);
    const activationHash = await this.rpc('getblockhash', [150]);
    assert.equal((await this.rpc('getblockheader', [activationHash, false])).length, 328, 'BLAKE2b header activation required');
    const config = path.join(this.directory, 'fulcrum.conf');
    writeFileSync(config, 'allow_extended_headers = true\npolltime = 1\n', {
      mode: 0o600,
    });
    this.launch(
      this.options.fulcrum,
      [
        '-D',
        path.join(this.directory, 'fulcrum'),
        '-b',
        '127.0.0.1:' + this.rpcPort,
        '-K',
        path.join(this.directory, 'node/regtest/.cookie'),
        '-t',
        '127.0.0.1:' + this.fulcrumPort,
        config,
      ],
      'fulcrum',
    );
    await this.waitForIndex();
    await this.startBridge();
  }

  async waitForIndex(): Promise<void> {
    const height = await this.rpc('getblockcount');
    await eventually(async () => (await this.electrum('blockchain.headers.subscribe')).height === height, 60_000);
  }

  private async startBridge(): Promise<void> {
    const fixture = (name: string) => readFileSync(path.join(process.cwd(), 'tests/fixtures/tls', name));
    const checkpointSource = readFileSync(path.join(process.cwd(), 'class/xbt/electrum-checkpoint.ts'), 'utf8');
    const match = checkpointSource.match(/'([0-9a-f]{328})'/);
    if (!match) throw new Error('Pinned checkpoint fixture absent');
    const checkpoint = match[1];
    this.bridge = tls.createServer({ key: fixture('server.key'), cert: fixture('native.pem') }, socket => {
      const upstream = net.connect(this.fulcrumPort, '127.0.0.1');
      this.sockets.add(socket);
      this.sockets.add(upstream);
      let buffer = '';
      let responseBuffer = '';
      upstream.on('data', data => {
        responseBuffer += data.toString();
        if (responseBuffer.length > 8_000_000) return socket.destroy();
        while (responseBuffer.includes('\n')) {
          const end = responseBuffer.indexOf('\n');
          const line = responseBuffer.slice(0, end);
          responseBuffer = responseBuffer.slice(end + 1);
          try {
            const message = JSON.parse(line);
            // Regtest verbose transactions label scripts bcrt1/tb1. Translate
            // labels from the actual script bytes, leaving transaction hex and
            // amounts intact. The native application still uses bc1 addresses.
            const translate = (value: any): void => {
              if (!value || typeof value !== 'object') return;
              if (value.scriptPubKey?.hex) {
                try {
                  const address = fixtureAddress(Buffer.from(value.scriptPubKey.hex, 'hex'));
                  if (value.scriptPubKey.address) value.scriptPubKey.address = address;
                  if (value.scriptPubKey.addresses) value.scriptPubKey.addresses = [address];
                } catch {}
              }
              for (const child of Object.values(value)) translate(child);
            };
            translate(message);
            socket.write(JSON.stringify(message) + '\n');
          } catch {
            socket.destroy();
          }
        }
      });
      upstream.on('error', () => socket.destroy());
      upstream.on('close', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
      socket.on('close', () => {
        upstream.destroy();
        this.sockets.delete(socket);
        this.sockets.delete(upstream);
      });
      socket.on('data', data => {
        if (this.fault === 'disconnect') {
          this.receipt.disconnectFaults++;
          socket.destroy();
          return;
        }
        buffer += data.toString();
        if (buffer.length > 8_000_000) return socket.destroy();
        while (buffer.includes('\n')) {
          const index = buffer.indexOf('\n');
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          let message: Request | Request[];
          try {
            message = JSON.parse(line);
          } catch {
            socket.destroy();
            return;
          }
          const requests = Array.isArray(message) ? message : [message];
          if (requests.some(request => typeof request.method !== 'string' || !Array.isArray(request.params))) {
            socket.destroy();
            return;
          }
          // Checkpoint is requested individually by the production transport.
          if (requests.some(request => request.method === 'blockchain.block.header' && request.params[0] === 961640)) {
            if (Array.isArray(message) || requests.length !== 1) {
              socket.destroy();
              return;
            }
            this.receipt.checkpointRequests++;
            socket.write(
              JSON.stringify({
                id: requests[0].id,
                result: this.fault === 'wrong-checkpoint' ? '00'.repeat(164) : checkpoint,
              }) + '\n',
            );
            continue;
          }
          if (this.fault === 'history-timeout' && requests.some(request => request.method === 'blockchain.scripthash.get_history'))
            continue;
          for (const request of requests) {
            this.receipt.forwardedMethods[request.method] = (this.receipt.forwardedMethods[request.method] || 0) + 1;
          }
          upstream.write(line + '\n');
        }
      });
    });
    this.bridge.on('tlsClientError', () => {});
    await new Promise<void>((resolve, reject) => {
      this.bridge!.once('error', reject);
      // Android's emulator connects through 10.0.2.2; reserve a local listener only.
      this.bridge!.listen(0, '127.0.0.1', resolve);
    });
    this.bridgePort = (this.bridge.address() as net.AddressInfo).port;
  }

  get tlsPort(): number {
    return this.bridgePort;
  }

  setCertificate(name: 'native.pem' | 'native-expired.pem'): void {
    if (!this.bridge) throw new Error('Test bridge has not started');
    this.disconnectClients();
    this.bridge.setSecureContext({
      key: readFileSync(path.join(process.cwd(), 'tests/fixtures/tls/server.key')),
      cert: readFileSync(path.join(process.cwd(), 'tests/fixtures/tls', name)),
    });
    if (name === 'native-expired.pem') this.receipt.invalidCertificateTested = true;
  }

  disconnectClients(): void {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  async fundAddress(mainnetAddress: string, valueSats: number): Promise<string> {
    assert.ok(Number.isSafeInteger(valueSats) && valueSats > 0);
    const script = fixtureOutputScript(mainnetAddress);
    const regtestAddress = fixtureAddress(script, 'bcrt');
    const raw = await this.rpc('createrawtransaction', [[], [{ [regtestAddress]: valueSats / 100_000_000 }]]);
    const funded = await this.rpc('fundrawtransaction', [raw, { fee_rate: 1 }], true);
    const signed = await this.rpc('signrawtransactionwithwallet', [funded.hex], true);
    assert.equal(signed.complete, true);
    const txid = await this.rpc('sendrawtransaction', [signed.hex]);
    this.receipt.fundingTxids.push(txid);
    await this.mine(2);
    return txid;
  }

  async mine(blocks = 2): Promise<void> {
    assert.ok(Number.isInteger(blocks) && blocks > 0 && blocks <= 200);
    await this.rpc('generatetoaddress', [blocks, this.minerAddress]);
    await this.waitForIndex();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.disconnectClients();
    if (this.bridge) await new Promise<void>(resolve => this.bridge!.close(() => resolve()));
    try {
      await this.rpc('stop');
    } catch {}
    const signalAndWait = (child: ChildProcess, signal: NodeJS.Signals) =>
      new Promise<void>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        const done = () => {
          clearTimeout(timer);
          child.removeListener('exit', done);
          resolve();
        };
        const timer = setTimeout(done, 5000);
        child.once('exit', done);
        child.kill(signal);
      });
    for (const child of [...this.processes].reverse()) {
      await signalAndWait(child, 'SIGTERM');
      await signalAndWait(child, 'SIGKILL');
    }
    for (const stream of this.streams) await new Promise<void>(resolve => stream.end(resolve));
    this.receipt.cleanupComplete = this.processes.every(child => child.exitCode !== null || child.signalCode !== null);
    if (this.options.artifactDirectory) {
      mkdirSync(this.options.artifactDirectory, { recursive: true });
      for (const name of ['knots', 'fulcrum']) {
        const file = path.join(this.directory, name + '.log');
        try {
          writeFileSync(path.join(this.options.artifactDirectory, name + '.log'), readFileSync(file));
        } catch {}
      }
      writeFileSync(path.join(this.options.artifactDirectory, 'backend-receipt.json'), JSON.stringify(this.receipt, null, 2) + '\n');
    }
    rmSync(this.directory, { recursive: true, force: true });
  }
}

export function backendOptions(artifactDirectory?: string): BackendOptions {
  const root = process.env.REDWALLET_BACKEND_BIN;
  if (!root || !path.isAbsolute(root)) throw new Error('Set REDWALLET_BACKEND_BIN to an explicit absolute test binary directory');
  return {
    bitcoind: path.join(root, 'bitcoind'),
    bitcoinCli: path.join(root, 'bitcoin-cli'),
    fulcrum: path.join(root, 'Fulcrum'),
    artifactDirectory,
  };
}
