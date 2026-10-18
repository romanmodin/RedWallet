/** Opt-in disposable, zero-peer XBT Knots validation. Only public fixture keys. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as bitcoin from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtBip84Transaction } from '../../class/xbt-bip84-transaction';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  multiGetTransactionByTxid: jest.fn(),
}));
const isolated = process.env.XBT_BIP84_NODE && process.env.XBT_BIP84_CLI ? it : it.skip;

isolated(
  'accepts and mines authenticated BIP84 replacement on isolated XBT Knots',
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redwallet-bip84-isolated-'));
    let node: ChildProcess | undefined;
    const receipts: unknown[] = [];
    const rpc = (method: string, ...params: unknown[]) => {
      const out = execFileSync(
        process.env.XBT_BIP84_CLI!,
        ['-datadir=' + directory, '-regtest', method, ...params.map(param => (typeof param === 'string' ? param : JSON.stringify(param)))],
        { encoding: 'utf8', timeout: 60_000, stdio: ['ignore', 'pipe', 'pipe'] },
      ).trim();
      try {
        return JSON.parse(out);
      } catch {
        return out;
      }
    };
    const accepted = (transaction: bitcoin.Transaction) => {
      const [acceptance] = rpc('testmempoolaccept', [transaction.toHex()]);
      expect(acceptance.allowed).toBe(true);
      expect(rpc('sendrawtransaction', transaction.toHex())).toBe(transaction.getId());
      return acceptance;
    };
    try {
      // Bind a unique loopback RPC port; no production config or existing data directory.
      const net = require('net');
      const probe = net.createServer();
      await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
      const port = probe.address().port;
      await new Promise<void>(resolve => probe.close(resolve));
      fs.writeFileSync(path.join(directory, 'bitcoin.conf'), '[regtest]\nrpcport=' + port + '\n', { mode: 0o600 });
      node = spawn(
        process.env.XBT_BIP84_NODE!,
        [
          '-datadir=' + directory,
          '-regtest',
          '-server',
          '-txindex=1',
          '-listen=0',
          '-connect=0',
          '-networkactive=0',
          '-dnsseed=0',
          '-discover=0',
          '-rpcbind=127.0.0.1',
          '-rpcallowip=127.0.0.1',
          '-fallbackfee=0.00001',
          '-testactivationheight=blake2b@150',
          '-blake2b_headline=RedWallet-public-BIP84-test',
        ],
        { stdio: 'ignore' },
      );
      const readyDeadline = Date.now() + 30_000;
      while (true) {
        try {
          expect(rpc('getblockchaininfo').chain).toBe('regtest');
          break;
        } catch (error) {
          if (Date.now() > readyDeadline) throw error;
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
      rpc('createwallet', 'public-bip84-fixture');
      const miner = rpc('getnewaddress');
      rpc('generatetoaddress', 151, miner);
      expect(rpc('getblockheader', rpc('getblockhash', 150), false)).toHaveLength(328);
      expect(rpc('getnetworkinfo').networkactive).toBe(false);
      expect(rpc('getconnectioncount')).toBe(0);
      (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async (ids: string[], verbose: boolean) =>
        Object.fromEntries(ids.map(id => [id, rpc('getrawtransaction', id, verbose)])),
      );
      const wallet = new XbtSegwitBech32Wallet();
      wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
      // Exercise the staged route without changing its production default.
      jest.spyOn(wallet, 'allowAuthenticatedRBF').mockReturnValue(true);
      const source = wallet._getExternalAddressByIndex(0);
      const recipient = wallet._getExternalAddressByIndex(1);
      const change = wallet._getInternalAddressByIndex(0);
      const script = bitcoin.address.toOutputScript(source);
      const fundingId = rpc('sendtoaddress', bitcoin.address.fromOutputScript(script, bitcoin.networks.regtest), 0.01);
      rpc('generatetoaddress', 1, miner);
      const funding = bitcoin.Transaction.fromHex(rpc('getrawtransaction', fundingId));
      const history: any[] = [{ txid: fundingId, rawHex: funding.toHex(), confirmations: 1 }];
      jest.spyOn(wallet, 'getTransactions').mockImplementation(() => history);
      const vout = funding.outs.findIndex(output => Buffer.from(output.script).equals(Buffer.from(script)));
      expect(vout).toBeGreaterThanOrEqual(0);
      const original = wallet.createTransaction(
        [{ txid: fundingId, vout, address: source, value: Number(funding.outs[vout].value), confirmations: 1 }],
        [{ address: recipient, value: 500000 }],
        1,
        change,
        0xfffffffd,
      );
      const originalAcceptance = accepted(original.tx!);
      history.push({ txid: original.tx!.getId(), rawHex: original.tx!.toHex(), confirmations: 0 });
      const adapter = new XbtBip84Transaction(original.tx!.getId(), wallet);
      await expect(adapter.createRBFbumpFee(1)).rejects.toThrow('incremental relay fee');
      expect(rpc('getrawmempool')).toContain(original.tx!.getId());
      const replacement = await adapter.createRBFbumpFee(10);
      expect(replacement.tx!.outs[0]).toEqual(original.tx!.outs[0]);
      expect(replacement.tx!.outs[1].script).toEqual(original.tx!.outs[1].script);
      expect(replacement.tx!.outs[1].value).toBeGreaterThanOrEqual(294n);
      expect(replacement.tx!.outs[1].value).toBeLessThan(original.tx!.outs[1].value);
      expect(replacement.fee).toBeGreaterThanOrEqual(original.fee + replacement.tx!.virtualSize());
      const replacementAcceptance = accepted(replacement.tx!);
      expect(rpc('getrawmempool')).not.toContain(original.tx!.getId());
      expect(rpc('getrawmempool')).toContain(replacement.tx!.getId());
      rpc('generatetoaddress', 1, miner);
      expect(rpc('getrawtransaction', replacement.tx!.getId(), true).confirmations).toBe(1);
      expect(rpc('getnetworkinfo').networkactive).toBe(false);
      expect(rpc('getconnectioncount')).toBe(0);
      receipts.push({
        format: 'BIP84',
        originalAcceptance,
        replacementAcceptance,
        originalHex: original.tx!.toHex(),
        replacementHex: replacement.tx!.toHex(),
        fundingHex: funding.toHex(),
        originalFee: original.fee,
        replacementFee: replacement.fee,
        originalTxid: original.tx!.getId(),
        replacementTxid: replacement.tx!.getId(),
        recipientPreserved: true,
        changeAboveDust: true,
        insufficientIncrementRejected: true,
        mined: true,
      });
      if (process.env.XBT_BIP84_RECEIPT)
        fs.writeFileSync(
          process.env.XBT_BIP84_RECEIPT,
          JSON.stringify(
            {
              chain: 'regtest',
              networkactive: false,
              connections: 0,
              receipts,
            },
            null,
            2,
          ) + '\n',
        );
    } finally {
      if (node) {
        try {
          rpc('stop');
        } catch {
          node.kill('SIGTERM');
        }
        if (node.exitCode === null) await new Promise<void>(resolve => node!.once('exit', () => resolve()));
      }
      fs.rmSync(directory, { recursive: true, force: true });
    }
  },
  180_000,
);
