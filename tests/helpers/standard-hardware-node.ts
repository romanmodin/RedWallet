/** Shared disposable two-chain test process. Never connects to a configured node. */
import assert from 'assert';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import net from 'net';
import { tmpdir } from 'os';
import path from 'path';

const originalFetch = global.fetch;

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

export class DisposableNode {
  directory = mkdtempSync(path.join(tmpdir(), 'redwallet-standard-regtest-'));
  child?: ChildProcess;
  port = 0;
  version = '';
  async rpc(method: string, params: unknown[] = [], wallet = false, timeoutMs = 30000): Promise<any> {
    const cookie = readFileSync(path.join(this.directory, 'regtest/.cookie'), 'utf8').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await originalFetch('http://127.0.0.1:' + this.port + (wallet ? '/wallet/public-test-miner' : '/'), {
        method: 'POST',
        headers: {
          Authorization: 'Basic ' + Buffer.from(cookie).toString('base64'),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: controller.signal,
      });
      const reply = (await response.json()) as {
        result: any;
        error?: { message: string };
      };
      if (reply.error) throw new Error('Disposable regtest ' + method + ': ' + reply.error.message);
      assert(response.ok, 'Disposable RPC HTTP ' + response.status);
      return reply.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async start(binary: string, blake: boolean) {
    this.version = execFileSync(binary, ['--version'], {
      encoding: 'utf8',
    }).split('\n')[0];
    assert(this.version.includes(blake ? 'Knots' : 'Core'), 'Wrong node implementation');
    this.port = await freePort();
    this.child = spawn(
      binary,
      [
        '-datadir=' + this.directory,
        '-regtest',
        '-server',
        '-txindex=1',
        '-listen=0',
        '-connect=0',
        '-dnsseed=0',
        '-discover=0',
        '-upnp=0',
        '-natpmp=0',
        '-rpcbind=127.0.0.1',
        '-rpcallowip=127.0.0.1',
        '-rpcport=' + this.port,
        '-fallbackfee=0.00001',
        '-nodebuglogfile',
        '-printtoconsole=0',
        ...(blake ? ['-testactivationheight=blake2b@150', '-blake2b_headline=RedWallet-public-regtest-only'] : []),
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    this.child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) throw new Error('Disposable node startup failed: ' + stderr);
      try {
        if ((await this.rpc('getblockchaininfo')).chain === 'regtest') {
          break;
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    assert((await this.rpc('getblockchaininfo')).chain === 'regtest', 'Disposable node readiness timed out');
    await this.rpc('createwallet', ['public-test-miner'], false, 120000);
  }

  async stop() {
    if (this.child && this.child.exitCode === null) {
      const child = this.child;
      const stopped = new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error('Node shutdown timed out'));
        }, 15000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      await this.rpc('stop').catch(() => child.kill('SIGTERM'));
      await stopped;
    }
    rmSync(this.directory, { recursive: true, force: true });
  }
}
