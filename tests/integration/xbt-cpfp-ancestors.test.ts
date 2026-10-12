/** Opt-in disposable, zero-peer XBT Knots validation. Only public fixture keys. */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync, spawn, ChildProcess } from 'child_process';
import * as bitcoin from 'bitcoinjs-lib';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { XbtTaprootWallet } from '../../class/wallets/xbt-taproot-wallet';
import { HDSegwitBech32Transaction } from '../../class/hd-segwit-bech32-transaction';
import { XbtTaprootTransaction } from '../../class/xbt-taproot-transaction';

jest.mock('../../blue_modules/BlueElectrum', () => ({
  createCpfpTransactionReader: jest.fn(),
  multiGetTransactionByTxid: jest.fn(),
  getTransactionsByAddress: jest.fn().mockResolvedValue([]),
}));
const isolated = process.env.XBT_CPFP_NODE && process.env.XBT_CPFP_CLI ? it : it.skip;

isolated(
  'mines branching multi-ancestor CPFP for SegWit and Taproot using real XBT Knots policy',
  async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'redwallet-cpfp-isolated-'));
    let node: ChildProcess | undefined;
    const receipts: unknown[] = [];
    const rpc = (method: string, ...params: unknown[]) => {
      const out = execFileSync(
        process.env.XBT_CPFP_CLI!,
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
        process.env.XBT_CPFP_NODE!,
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
          '-blake2b_headline=RedWallet-public-CPFP-test',
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
      rpc('createwallet', 'public-cpfp-fixture');
      const miner = rpc('getnewaddress');
      rpc('generatetoaddress', 151, miner);
      expect(rpc('getblockheader', rpc('getblockhash', 150), false)).toHaveLength(328);
      expect(rpc('getnetworkinfo').networkactive).toBe(false);
      expect(rpc('getconnectioncount')).toBe(0);
      (BlueElectrum.createCpfpTransactionReader as jest.Mock).mockImplementation(
        () => async (id: string) => rpc('getrawtransaction', id, true),
      );
      (BlueElectrum.multiGetTransactionByTxid as jest.Mock).mockImplementation(async (ids: string[], verbose: boolean) =>
        Object.fromEntries(ids.map(id => [id, rpc('getrawtransaction', id, verbose)])),
      );
      for (const format of ['segwit', 'taproot']) {
        const wallet = format === 'segwit' ? new XbtSegwitBech32Wallet() : new XbtTaprootWallet();
        wallet.setSecret('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
        const address = wallet._getExternalAddressByIndex(0);
        const decoded = bitcoin.address.fromBech32(address);
        const regtestAddress = bitcoin.address.toBech32(decoded.data, decoded.version, 'bcrt');
        const fundingId = rpc('sendtoaddress', regtestAddress, 0.01);
        rpc('generatetoaddress', 1, miner);
        const funding = bitcoin.Transaction.fromHex(rpc('getrawtransaction', fundingId));
        const history: any[] = [{ txid: fundingId, rawHex: funding.toHex(), confirmations: 1 }];
        jest.spyOn(wallet, 'getTransactions').mockImplementation(() => history);
        jest.spyOn(wallet, 'fetchUtxo').mockResolvedValue();
        const change = wallet._getInternalAddressByIndex(0);
        jest.spyOn(wallet, 'getChangeAddressAsync').mockResolvedValue(change);
        const outputs = (transaction: bitcoin.Transaction) =>
          transaction.outs.flatMap((output, vout) => {
            let own: string;
            try {
              own = bitcoin.address.fromOutputScript(output.script);
            } catch {
              return [];
            }
            return wallet.weOwnAddress(own)
              ? [
                  {
                    txid: transaction.getId(),
                    vout,
                    address: own,
                    value: Number(output.value),
                    confirmations: transaction === funding ? 1 : 0,
                    height: transaction === funding ? 152 : 0,
                  },
                ]
              : [];
          });
        const remember = (transaction: bitcoin.Transaction) => {
          accepted(transaction);
          history.push({ txid: transaction.getId(), rawHex: transaction.toHex(), confirmations: 0 });
        };
        const first = wallet.createTransaction(outputs(funding), [{ address, value: 500_000 }], 1, change);
        remember(first.tx!);
        const firstOutputs = outputs(first.tx!);
        expect(firstOutputs).toHaveLength(2);
        const left = wallet.createTransaction([firstOutputs[0]], [{ address }], 1, change);
        remember(left.tx!);
        const right = wallet.createTransaction([firstOutputs[1]], [{ address }], 1, change);
        remember(right.tx!);
        const parent = wallet.createTransaction([...outputs(left.tx!), ...outputs(right.tx!)], [{ address }], 1, change);
        remember(parent.tx!);
        wallet._utxo = outputs(parent.tx!);
        const helper =
          format === 'segwit'
            ? new HDSegwitBech32Transaction(parent.tx!.toHex(), parent.tx!.getId(), wallet as XbtSegwitBech32Wallet)
            : new XbtTaprootTransaction(parent.tx!.toHex(), parent.tx!.getId(), wallet as XbtTaprootWallet);
        const child = await helper.createCPFPbumpFee(10);
        const acceptance = accepted(child.tx!);
        const entry = rpc('getmempoolentry', child.tx!.getId());
        expect(entry.ancestorcount).toBe(5);
        const totalFee = first.fee + left.fee + right.fee + parent.fee + child.fee;
        const totalSize = [first, left, right, parent, child].reduce((sum, item) => sum + item.tx!.virtualSize(), 0);
        expect(totalFee / totalSize).toBeGreaterThanOrEqual(10);
        expect(Math.round(entry.fees.ancestor * 1e8)).toBe(totalFee);
        expect(entry.ancestorsize).toBe(totalSize);
        rpc('generatetoaddress', 1, miner);
        expect(rpc('getrawtransaction', child.tx!.getId(), true).confirmations).toBe(1);
        receipts.push({ format, ancestorCount: 4, childTxid: child.tx!.getId(), totalFee, totalSize, acceptance, mined: true });
      }
      if (process.env.XBT_CPFP_RECEIPT)
        fs.writeFileSync(
          process.env.XBT_CPFP_RECEIPT,
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
