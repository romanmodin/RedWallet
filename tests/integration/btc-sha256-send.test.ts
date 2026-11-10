/**
 * Real SHA-256 consensus/send check with disposable regtest coins.
 * Requires a Bitcoin Core binary; never use a configured node or real coins.
 * This exercises the production BTC signer, not the Electrum/native transport.
 */
import assert from 'assert';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import net from 'net';
import { tmpdir } from 'os';
import path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import { BtcWatchOnlyWallet } from '../../class/wallets/btc-watch-only-wallet';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import { BlueURDecoder, encodeUR } from '../../blue_modules/ur';
import { BtcSegwitBech32Wallet } from '../../class/wallets/btc-segwit-bech32-wallet';
import { assertXbtUnifiedTransaction } from '../../class/xbt/broadcast-validation';

const binary = process.env.REDWALLET_BTC_REGTEST_BITCOIND;
const real = binary ? test : test.skip;
// Published BIP39 vectors, used only with newly mined disposable regtest coins.
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const recipientSeed = 'legal winner thank year wave sausage worth useful legal winner thank yellow';

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

real(
  'BTC signer sends the reviewed amount and fee through a real SHA-256 node',
  async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'redwallet-btc-regtest-'));
    const port = await freePort();
    const artifactDirectory = process.env.REDWALLET_BTC_REGTEST_ARTIFACT_DIR || 'artifacts/btc-sha256-regtest';
    let child: ChildProcess | undefined;
    let cleanupComplete = false;
    let receipt: Record<string, unknown> | undefined;
    const rpc = async (method: string, params: unknown[] = [], wallet = false) => {
      const cookie = readFileSync(path.join(directory, 'regtest/.cookie'), 'utf8').trim();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30_000);
      try {
        const response = await fetch('http://127.0.0.1:' + port + (wallet ? '/wallet/public-test-miner' : '/'), {
          method: 'POST',
          headers: { Authorization: 'Basic ' + Buffer.from(cookie).toString('base64'), 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          signal: controller.signal,
        });
        const reply = (await response.json()) as { result: any; error?: { message: string } };
        if (reply.error) throw new Error('Disposable Bitcoin ' + method + ': ' + reply.error.message);
        assert(response.ok, 'Disposable Bitcoin RPC HTTP ' + response.status);
        return reply.result;
      } finally {
        clearTimeout(timer);
      }
    };
    try {
      const version = execFileSync(binary!, ['--version'], { encoding: 'utf8' }).split('\n')[0];
      assert(version.startsWith('Bitcoin Core daemon version'), 'This test requires Bitcoin Core, not an XBT fork');
      child = spawn(
        binary!,
        [
          '-datadir=' + directory,
          '-regtest',
          '-server',
          '-listen=0',
          '-connect=0',
          '-dnsseed=0',
          '-discover=0',
          '-upnp=0',
          '-natpmp=0',
          '-rpcbind=127.0.0.1',
          '-rpcallowip=127.0.0.1',
          '-rpcport=' + port,
          '-fallbackfee=0.00001',
          '-nodebuglogfile',
          '-printtoconsole=0',
        ],
        { stdio: 'ignore' },
      );
      let ready = false;
      const deadline = Date.now() + 30_000;
      while (!ready && Date.now() < deadline) {
        if (child.exitCode !== null) throw new Error('Disposable Bitcoin node exited before RPC readiness');
        try {
          ready = (await rpc('getblockchaininfo')).chain === 'regtest';
        } catch {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      assert(ready, 'Disposable Bitcoin RPC readiness deadline exceeded');
      await rpc('createwallet', ['public-test-miner']);
      const miner = await rpc('getnewaddress', [], true);
      await rpc('generatetoaddress', [101, miner]);
      const wallet = new BtcSegwitBech32Wallet();
      wallet.setSecret(seed);
      const recipient = new BtcSegwitBech32Wallet();
      recipient.setSecret(recipientSeed);
      const address = wallet._getExternalAddressByIndex(0);
      const destination = recipient._getExternalAddressByIndex(0);
      const change = wallet._getInternalAddressByIndex(0);
      const regtestAddress = bitcoin.address.fromOutputScript(bitcoin.address.toOutputScript(address), bitcoin.networks.regtest);
      const fundingID = await rpc('sendtoaddress', [regtestAddress, 0.001], true);
      const fundingBlocks = await rpc('generatetoaddress', [1, miner]);
      const parent = await rpc('getrawtransaction', [fundingID, true, fundingBlocks[0]]);
      const fundingOutput = parent.vout.find(
        (output: any) => output.scriptPubKey.hex === Buffer.from(bitcoin.address.toOutputScript(address)).toString('hex'),
      );
      assert(fundingOutput, 'Real funding output missing');
      const expectedScript = bitcoin.address.toOutputScript(destination);
      const getTransactions = jest.spyOn(wallet, 'getTransactions').mockReturnValue([
        {
          txid: fundingID,
          rawHex: parent.hex,
          confirmations: parent.confirmations,
        } as any,
      ]);
      let signed: ReturnType<BtcSegwitBech32Wallet['createTransaction']>;
      try {
        signed = wallet.createTransaction(
          [
            {
              txid: fundingID,
              vout: fundingOutput.n,
              value: 100_000,
              address,
              confirmations: parent.confirmations,
            },
          ],
          [{ address: destination, value: 20_000 }],
          2,
          change,
        );
      } finally {
        getTransactions.mockRestore();
      }
      assert(signed.tx, 'Production BTC signer returned no transaction');
      const cold = new BtcWatchOnlyWallet();
      cold.setSecret(JSON.stringify({ xpub: wallet.getXpub(), path: "m/84'/0'/0'", xfp: '73c5da0a' })).init();
      cold.setUseWithHardwareWalletEnabled(true);
      const history = jest
        .spyOn(cold._hdWalletInstance!, 'getTransactions')
        .mockReturnValue([{ txid: fundingID, rawHex: parent.hex, confirmations: parent.confirmations } as any]);
      let tx: bitcoin.Transaction;
      try {
        const request = cold.createTransaction(
          [{ txid: fundingID, vout: fundingOutput.n, value: 100_000, address, confirmations: parent.confirmations }],
          [{ address: destination, value: 20_000 }],
          2,
          cold._getInternalAddressByIndex(0),
        );
        const returned = request.psbt.clone();
        // Simulate the offline device with a published test seed, never a user's keys.
        returned.signInput(0, ECPairFactory(ecc).fromWIF(wallet._getWifForAddress(address)!));
        const parts = encodeUR(returned.toHex(), 80, null, 'URv2');
        const decoder = new BlueURDecoder();
        for (const part of [...parts].reverse()) decoder.receivePart(part.toUpperCase());
        assert(decoder.isComplete(), 'Signed QR not complete');
        tx = cold.combinePsbt(request.psbt, decoder.toString());
        const changed = tx.clone();
        changed.outs[0].value += 1n;
        expect(() => cold.acceptSignedTransaction(changed.toHex(), request.psbt)).toThrow();
        // The refused return clears approval. Verify the genuine return again.
        cold.combinePsbt(request.psbt, decoder.toString());
      } finally {
        history.mockRestore();
      }
      const reviewedHex = tx.toHex();
      expect(() => assertXbtUnifiedTransaction(reviewedHex)).toThrow();
      expect(tx.outs.filter(output => Buffer.from(output.script).equals(Buffer.from(expectedScript)))).toHaveLength(1);
      expect(tx.outs.find(output => Buffer.from(output.script).equals(Buffer.from(expectedScript)))!.value).toBe(20_000n);
      const actualFee = 100_000 - tx.outs.reduce((total, output) => total + Number(output.value), 0);
      expect(actualFee).toBe(signed.fee);
      expect(actualFee).toBeGreaterThanOrEqual(tx.virtualSize() * 2);
      const accepted = await rpc('testmempoolaccept', [[reviewedHex]]);
      expect(accepted[0].allowed).toBe(true);
      // Altering the signed recipient amount must be rejected by consensus.
      const altered = bitcoin.Transaction.fromHex(reviewedHex);
      altered.outs[0].value += 1n;
      const refused = await rpc('testmempoolaccept', [[altered.toHex()]]);
      expect(refused[0].allowed).toBe(false);
      // Submit exactly once, using the immutable bytes that were reviewed above.
      let broadcastCount = 0;
      jest.spyOn(cold, 'getElectrum').mockReturnValue({
        broadcastV2: async (hex: string) => {
          broadcastCount += 1;
          expect(hex).toBe(reviewedHex);
          return rpc('sendrawtransaction', [hex]);
        },
      } as any);
      expect(await cold.broadcastTx(reviewedHex)).toBe(true);
      expect(broadcastCount).toBe(1);
      const sentID = tx.getId();
      const mempool = await rpc('getmempoolentry', [sentID]);
      expect(Math.round(mempool.fees.base * 100_000_000)).toBe(actualFee);
      const settledBlocks = await rpc('generatetoaddress', [2, miner]);
      const settled = await rpc('getrawtransaction', [sentID, true, settledBlocks[0]]);
      expect(settled.hex).toBe(reviewedHex);
      expect(settled.confirmations).toBe(2);
      const tipHash = await rpc('getbestblockhash');
      const header = await rpc('getblockheader', [tipHash, false]);
      expect(header).toHaveLength(160); // 80-byte Bitcoin SHA-256 header.
      receipt = {
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        binarySha256: createHash('sha256').update(readFileSync(binary!)).digest('hex'),
        harnessSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
        version,
        chain: 'isolated Bitcoin Core regtest, SHA-256',
        transport: 'local node RPC; production signer, no Electrum or native UI qualification',
        amountSats: 20_000,
        feeSats: actualFee,
        rateSatPerVbyte: 2,
        vsize: tx.virtualSize(),
        txid: sentID,
        confirmations: settled.confirmations,
        alteredAmountRejected: true,
        hardwareQrRoundTripVerified: true,
        hardwareBroadcastCount: broadcastCount,
        hardwareSigner: 'Simulated device using a published test seed; not physical Keystone qualification',
        observedAt: new Date().toISOString(),
      };
    } finally {
      if (child) {
        const stopped = new Promise<void>((resolve, reject) => {
          if (child!.exitCode !== null) return resolve();
          child!.once('exit', () => resolve());
          const timer = setTimeout(() => {
            child!.kill('SIGTERM');
            reject(new Error('Disposable Bitcoin node did not stop within 15 seconds'));
          }, 15_000);
          child!.once('exit', () => clearTimeout(timer));
        });
        await rpc('stop').catch(() => child!.kill('SIGTERM'));
        await stopped;
      }
      rmSync(directory, { recursive: true, force: true });
      cleanupComplete = true;
      if (receipt) {
        mkdirSync(artifactDirectory, { recursive: true });
        writeFileSync(path.join(artifactDirectory, 'receipt.json'), JSON.stringify({ ...receipt, cleanupComplete }, null, 2) + '\n');
      }
    }
    expect(cleanupComplete).toBe(true);
  },
  180_000,
);
