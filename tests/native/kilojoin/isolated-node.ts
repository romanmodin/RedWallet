/** Public-fixture-only node. Never reads an existing node configuration or data directory. */
import { spawn, execFileSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { tmpdir } from 'os';
import path from 'path';
import net from 'net';
import { address, networks } from 'bitcoinjs-lib';
import { Coin, coinScript } from '../../../class/xbt/kilojoin/transaction';
export async function isolatedNode(binaryDirectory: string) {
  const node = path.join(binaryDirectory, 'bitcoind');
  const binarySha256 = createHash('sha256').update(readFileSync(node)).digest('hex');
  if (binarySha256 !== 'd04cd8211e711af989a7a62d0b8b55a8cfe496694392518da0ccb848469b3799')
    throw new Error('Unexpected isolated node binary');
  const directory = mkdtempSync(path.join(tmpdir(), 'kilojoin-v4-regtest-'));
  const socket = net.createServer();
  await new Promise<void>(resolve => socket.listen(0, '127.0.0.1', resolve));
  const port = (socket.address() as net.AddressInfo).port;
  await new Promise<void>((resolve, reject) => socket.close(e => (e ? reject(e) : resolve())));
  const cli = path.join(binaryDirectory, 'bitcoin-cli');
  const common = ['-regtest', '-datadir=' + directory, '-rpcport=' + port];
  const rpc = (method: string, params: unknown[] = []): any => {
    const result = execFileSync(
      cli,
      [...common, '-rpcclienttimeout=60', method, ...params.map(v => (typeof v === 'string' ? v : JSON.stringify(v)))],
      { encoding: 'utf8', timeout: 65000, stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    try {
      return JSON.parse(result);
    } catch {
      return result;
    }
  };
  const process = spawn(
    node,
    [
      ...common,
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
      '-fallbackfee=0.00001',
      '-testactivationheight=blake2b@150',
      '-blake2b_headline=Kilojoin-public-fixture-only',
      '-printtoconsole=0',
    ],
    { stdio: 'ignore' },
  );
  const exited = new Promise(resolve => {
    process.once('exit', resolve);
    process.once('error', resolve);
  });
  const close = async () => {
    if (process.exitCode === null) {
      try {
        rpc('stop');
      } catch {
        process.kill('SIGTERM');
      }
      const timer = setTimeout(() => process.kill('SIGKILL'), 5000);
      await exited;
      clearTimeout(timer);
    }
    rmSync(directory, { recursive: true, force: true });
  };
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        ready = rpc('getblockchaininfo').chain === 'regtest';
      } catch {}
      if (ready) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Isolated node did not start');
    rpc('createwallet', ['public-fixture-miner']);
    const miner = rpc('getnewaddress');
    rpc('generatetoaddress', [151, miner]);
    if (rpc('getblockheader', [rpc('getblockhash', [150]), false]).length !== 328) throw new Error('BLAKE2b activation missing');
    return {
      cli,
      common,
      rpc,
      close,
      binarySha256,
      miner,
      fund: (coins: Coin[]) => {
        for (const c of coins) {
          const script = coinScript(c);
          c.txid = rpc('sendtoaddress', [address.fromOutputScript(script, networks.regtest), c.value / 1e8]);
          const tx = rpc('getrawtransaction', [c.txid, true]);
          c.vout = tx.vout.find((o: any) => o.scriptPubKey.hex === script.toString('hex')).n;
        }
        rpc('generatetoaddress', [1, miner]);
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
