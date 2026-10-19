/** Opt-in, disposable, network-disabled XBT regtest. Only public fixture keys. */
import { spawn, execFileSync, ChildProcess } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import net from 'net';
import { createHash } from 'crypto';
import { address, networks, crypto as bitcoinCrypto, Transaction } from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../../blue_modules/noble_ecc';
import { Coin, coinScript, plan, digest, assemble, outpoint, change } from '../../../class/xbt/kilojoin/transaction';
const binaryDirectory = process.env.KILOJOIN_REGTEST_BIN;
const ECPair = ECPairFactory(ecc);
const key = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const coin = (n: number, type: Coin['type']): Coin => ({
  txid: '00'.repeat(32),
  vout: 0,
  value: 50000,
  type,
  pubkey: Buffer.from(ecc.pointFromScalar(key(n), true)!).toString('hex'),
});
(binaryDirectory ? test : test.skip)(
  'XBT node accepts and mines both CoinJoin script types; rejects corrupted signatures',
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'kilojoin-isolated-regtest-'));
    let child: ChildProcess | undefined;
    let exited: Promise<unknown> | undefined;
    let rpc: ((method: string, params?: unknown[]) => any) | undefined;
    const receipts: unknown[] = [];
    try {
      const server = net.createServer();
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as net.AddressInfo).port;
      await new Promise<void>((resolve, reject) => server.close(e => (e ? reject(e) : resolve())));
      const node = path.join(binaryDirectory!, 'bitcoind');
      const cli = path.join(binaryDirectory!, 'bitcoin-cli');
      const common = ['-regtest', '-datadir=' + directory, '-rpcport=' + port];
      rpc = (method, params = []) => {
        const output = execFileSync(
          cli,
          [...common, '-rpcclienttimeout=60', method, ...params.map(p => (typeof p === 'string' ? p : JSON.stringify(p)))],
          { encoding: 'utf8', timeout: 65000, stdio: ['ignore', 'pipe', 'pipe'] },
        ).trim();
        try {
          return JSON.parse(output);
        } catch {
          return output;
        }
      };
      child = spawn(
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
      exited = new Promise(resolve => {
        child!.once('exit', resolve);
        child!.once('error', resolve);
      });
      let ready = false;
      for (let i = 0; i < 100; i++) {
        try {
          ready = rpc('getblockchaininfo').chain === 'regtest';
        } catch {}
        if (ready) break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      expect(ready).toBe(true);
      rpc('createwallet', ['public-fixture-miner']);
      const miner = rpc('getnewaddress');
      rpc('generatetoaddress', [151, miner]);
      expect(rpc('getblockheader', [rpc('getblockhash', [150]), false]).length).toBe(328);
      for (const type of ['p2wpkh', 'p2tr'] as const) {
        const coins = [coin(1, type), coin(2, type)];
        for (const c of coins) {
          const script = coinScript(c);
          const target = address.fromOutputScript(script, networks.regtest);
          c.txid = rpc('sendtoaddress', [target, c.value / 1e8]);
          const funding = rpc('getrawtransaction', [c.txid, true]);
          c.vout = funding.vout.find((o: any) => o.scriptPubKey.hex === script.toString('hex')).n;
        }
        rpc('generatetoaddress', [1, miner]);
        const output = (n: number) => coinScript(coin(n, type)).toString('hex');
        const p = plan(
          coins,
          [output(5), output(6)],
          [3, 4].map(n => ({ script: output(n), value: change(50000, 10000, 2, 1, type)! })),
          10000,
        );
        const signatures = new Map(
          p.coins.map((c, index) => {
            const privateKey = key(coins.findIndex(original => outpoint(original) === outpoint(c)) + 1);
            const internal = ecc.pointFromScalar(privateKey, true)!.slice(1);
            const sig =
              type === 'p2wpkh'
                ? ecc.signDER(digest(p, index), privateKey)
                : ECPair.fromPrivateKey(privateKey).tweak(bitcoinCrypto.taggedHash('TapTweak', internal)).signSchnorr!(digest(p, index));
            return [outpoint(c), Buffer.concat([sig, Buffer.from([0x21])]).toString('hex')] as const;
          }),
        );
        const raw = assemble(p, signatures);
        const damaged = Transaction.fromHex(raw);
        damaged.ins[0].witness[0][10] = (damaged.ins[0].witness[0][10] + 1) % 256;
        expect(rpc('testmempoolaccept', [[damaged.toHex()]])[0].allowed).toBe(false);
        const accepted = rpc('testmempoolaccept', [[raw]])[0];
        expect(accepted.allowed).toBe(true);
        const txid = rpc('sendrawtransaction', [raw]);
        expect(txid).toBe(Transaction.fromHex(raw).getId());
        rpc('generatetoaddress', [1, miner]);
        expect(rpc('getrawtransaction', [txid, true]).confirmations).toBe(1);
        receipts.push({ type, txid, accepted: true, confirmations: 1, corruptedSignatureRejected: true });
      }
      if (process.env.KILOJOIN_REGTEST_RECEIPT)
        writeFileSync(
          process.env.KILOJOIN_REGTEST_RECEIPT,
          JSON.stringify(
            {
              sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
              chain: 'regtest',
              peerNetworkDisabled: true,
              blake2bActivationVerified: true,
              binarySha256: createHash('sha256').update(readFileSync(node)).digest('hex'),
              transactions: receipts,
            },
            null,
            2,
          ),
        );
    } finally {
      if (child && child.exitCode === null) {
        try {
          rpc?.('stop');
        } catch {
          child.kill('SIGTERM');
        }
        await Promise.race([
          exited,
          new Promise<void>(resolve => {
            const t = setTimeout(() => {
              child?.kill('SIGKILL');
              resolve();
            }, 5000);
            t.unref();
          }),
        ]);
        await exited;
      }
      rmSync(directory, { recursive: true, force: true });
    }
  },
  180000,
);
