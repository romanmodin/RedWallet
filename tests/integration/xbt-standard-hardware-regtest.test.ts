/**
 * Disposable shared-history regtest qualification for standard XBT signing.
 * Public BIP39 vector only. No configured node, real coin or physical signer.
 * RPC uses fresh directories, loopback ports and no peers.
 */
import assert from 'assert';
import { spawn, execFileSync, ChildProcess } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'fs';
import net from 'net';
import { tmpdir } from 'os';
import path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import ecc from '../../blue_modules/noble_ecc';
import * as BlueElectrum from '../../blue_modules/BlueElectrum';
import { WatchOnlyWallet } from '../../class/wallets/watch-only-wallet';
import { XbtSegwitBech32Wallet } from '../../class/wallets/xbt-segwit-bech32-wallet';
import { signUnifiedP2wpkhInput, finalizeUnifiedP2wpkhInput } from '../../class/xbt/unified-psbt';
import { verifyFundingConflict } from '../../class/xbt/separation-proof';
import { verifyPublicFundingSeparation } from '../../class/xbt/separation-service';
import { assertStandardHardwareResult } from '../../class/xbt/standard-hardware';
import { BlueURDecoder, encodeUR } from '../../blue_modules/ur';

// Only the runtime release switch is bypassed in this opt-in test.
jest.mock('../../class/xbt/standard-hardware', () => ({
  ...jest.requireActual('../../class/xbt/standard-hardware'),
  assertStandardHardwareReleased: jest.fn(),
}));

const coreBinary = process.env.REDWALLET_BTC_REGTEST_BITCOIND;
const knotsBinary = process.env.REDWALLET_XBT_REGTEST_BITCOIND;
const real = coreBinary && knotsBinary ? test : test.skip;
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const originalFetch = global.fetch;
const offset = 961640 - 150;
const checkpoint = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

class DisposableNode {
  directory = mkdtempSync(path.join(tmpdir(), 'redwallet-standard-regtest-'));
  child?: ChildProcess;
  port = 0;
  version = '';
  async rpc(method: string, params: unknown[] = [], wallet = false): Promise<any> {
    const cookie = readFileSync(path.join(this.directory, 'regtest/.cookie'), 'utf8').trim();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
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
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      if (this.child.exitCode !== null) throw new Error('Disposable node startup failed: ' + stderr);
      try {
        if ((await this.rpc('getblockchaininfo')).chain === 'regtest') {
          await this.rpc('createwallet', ['public-test-miner']);
          return;
        }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    throw new Error('Disposable node readiness timed out');
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

real(
  'standard cold signatures work on separated XBT coins and cannot replay on the conflicting SHA-256 branch',
  async () => {
    const core = new DisposableNode();
    const knots = new DisposableNode();
    let receipt: Record<string, unknown> | undefined;
    try {
      await core.start(coreBinary!, false);
      await knots.start(knotsBinary!, true);
      const miner = await core.rpc('getnewaddress', [], true);
      const xbtMiner = await knots.rpc('getnewaddress', [], true);
      const cold = new XbtSegwitBech32Wallet();
      cold.setSecret(seed);
      const receive = cold._getExternalAddressByIndex(0);
      const key = ECPairFactory(ecc).fromWIF(cold._getWifForAddress(receive)!);
      const regtestAddress = bitcoin.address.fromOutputScript(bitcoin.address.toOutputScript(receive), bitcoin.networks.regtest);
      await core.rpc('generatetoaddress', [101, miner]);
      const ancestorId = await core.rpc('sendtoaddress', [regtestAddress, 0.01], true);
      await core.rpc('generatetoaddress', [48, miner]);
      const ancestor = bitcoin.Transaction.fromHex(await core.rpc('getrawtransaction', [ancestorId]));
      const index = ancestor.outs.findIndex(out => Buffer.from(out.script).equals(Buffer.from(bitcoin.address.toOutputScript(receive))));
      assert(index >= 0 && ancestor.outs[index].value === 1000000n, 'Shared funding output');
      // Import the exact pre-activation blocks into Knots. Both chains share the
      // same spendable outpoint, rather than trivially testing unrelated chains.
      for (let height = 1; height <= 149; height++) {
        const hash = await core.rpc('getblockhash', [height]);
        expect(await knots.rpc('submitblock', [await core.rpc('getblock', [hash, 0])])).toBeNull();
      }
      const sharedTip = await core.rpc('getbestblockhash');
      expect(await knots.rpc('getbestblockhash')).toBe(sharedTip);
      await knots.rpc('generatetoaddress', [1, xbtMiner]);
      const xbtHeader = await knots.rpc('getblockheader', [await knots.rpc('getbestblockhash'), false]);
      expect(xbtHeader).toHaveLength(328);

      const buildParent = (unified: boolean, value = 999000n) => {
        const p = new bitcoin.Psbt();
        p.addInput({
          hash: ancestorId,
          index,
          nonWitnessUtxo: ancestor.toBuffer(),
          witnessUtxo: ancestor.outs[index],
          sighashType: unified ? 0x21 : 1,
        });
        p.addOutput({ address: receive, value });
        if (unified) {
          signUnifiedP2wpkhInput(p, 0, key);
          finalizeUnifiedP2wpkhInput(p, 0, key.publicKey, (pubkey, hash, sig) => ecc.verify(hash, pubkey, sig));
        } else {
          p.signInput(0, key);
          p.finalizeAllInputs();
        }
        return p.extractTransaction();
      };
      const funding = buildParent(true);
      const sameBodyStandard = buildParent(false);
      expect(sameBodyStandard.getId()).toBe(funding.getId());
      const coreUnified = (await core.rpc('testmempoolaccept', [[funding.toHex()]]))[0];
      expect(coreUnified.allowed).toBe(false);
      expect((await core.rpc('testmempoolaccept', [[sameBodyStandard.toHex()]]))[0].allowed).toBe(true);
      expect((await knots.rpc('testmempoolaccept', [[funding.toHex()]]))[0].allowed).toBe(true);
      const relabeled = sameBodyStandard.clone();
      relabeled.ins[0].witness[0][relabeled.ins[0].witness[0].length - 1] = 0x21;
      expect((await knots.rpc('testmempoolaccept', [[relabeled.toHex()]]))[0].allowed).toBe(false);
      await knots.rpc('sendrawtransaction', [funding.toHex()]);
      const xbtBlocks = await knots.rpc('generatetoaddress', [6, xbtMiner]);
      const confirmed = await knots.rpc('getrawtransaction', [funding.getId(), true, xbtBlocks[0]]);
      expect(confirmed.confirmations).toBe(6);

      const watch = new WatchOnlyWallet();
      watch.setSecret('[73c5da0a/84h/0h/0h]' + cold.getXpub());
      watch.init();
      watch.setUseWithHardwareWalletEnabled(true);
      watch.setHardwareSigningMode('standard');
      jest.spyOn(watch._hdWalletInstance!, 'getTransactions').mockReturnValue([
        {
          txid: funding.getId(),
          rawHex: funding.toHex(),
          confirmations: 6,
        } as any,
      ]);
      const coins = [
        {
          txid: funding.getId(),
          vout: 0,
          value: 999000,
          address: receive,
          confirmations: 6,
        },
      ];
      const targets = [{ address: cold._getExternalAddressByIndex(1), value: 100000 }];
      jest
        .spyOn(BlueElectrum, 'multiGetTransactionByTxid')
        .mockImplementation(
          async (ids: string[]): Promise<Record<string, string>> =>
            Object.fromEntries(await Promise.all(ids.map(async (id: string) => [id, await knots.rpc('getrawtransaction', [id])]))),
        );
      // Only heights are translated to exercise unchanged mainnet gates at a
      // practical regtest height. Transaction/header/proof bytes are real.
      jest.spyOn(BlueElectrum, 'getReportedBlockTip').mockImplementation(async () => (await knots.rpc('getblockcount')) + offset);
      jest.spyOn(BlueElectrum, 'multiGetHistoryByAddress').mockImplementation(
        async () =>
          ({
            [receive]: [{ tx_hash: funding.getId(), height: 151 + offset }],
          }) as any,
      );

      let conflictBlock: any = null;
      let conflict: bitcoin.Transaction | null = null;
      let blockHeader = '';
      let providerCalls = 0;
      // Local explorer adapter: both URLs read the isolated Core node. This tests
      // the production verification algorithm, not independence or HTTPS/TLS.
      global.fetch = jest.fn(async (url: any) => {
        const parsed = new URL(url);
        assert(['blockstream.info', 'mempool.space'].includes(parsed.hostname), 'Unexpected external request');
        providerCalls++;
        const endpoint = parsed.pathname.replace('/api', '');
        let value: string;
        if (endpoint === '/block-height/961640') value = checkpoint;
        else if (endpoint === '/blocks/tip/height') value = String((await core.rpc('getblockcount')) + offset);
        else if (endpoint === '/tx/' + ancestorId + '/outspend/' + index)
          value = JSON.stringify(
            conflict
              ? {
                  spent: true,
                  txid: conflict.getId(),
                  status: {
                    confirmed: true,
                    block_height: conflictBlock.height + offset,
                    block_hash: conflictBlock.hash,
                  },
                }
              : { spent: false },
          );
        else if (conflict && endpoint === '/tx/' + conflict.getId() + '/hex') value = conflict.toHex();
        else if (conflict && endpoint === '/tx/' + conflict.getId() + '/merkle-proof')
          value = JSON.stringify({
            block_height: conflictBlock.height + offset,
            pos: 1,
            merkle: [conflictBlock.tx[0]],
          });
        else if (conflictBlock && endpoint === '/block-height/' + (conflictBlock.height + offset))
          value = await core.rpc('getblockhash', [conflictBlock.height]);
        else if (conflictBlock && endpoint === '/block/' + conflictBlock.hash + '/header') value = blockHeader;
        else if (conflictBlock && endpoint === '/block/' + conflictBlock.hash)
          value = JSON.stringify({
            id: conflictBlock.hash,
            height: conflictBlock.height + offset,
            tx_count: conflictBlock.tx.length,
          });
        else throw new Error('Unexpected explorer request ' + endpoint);
        return {
          ok: true,
          redirected: false,
          url,
          headers: { get: () => null },
          text: async () => value,
        } as any;
      });
      // Mature BTC tip, but no conflicting spend: the witness difference alone
      // must not grant signing permission, even with confirmed Unified funding.
      await core.rpc('generatetoaddress', [7, miner]);
      await expect(watch.createStandardHardwareTransaction(coins, targets, 2, watch._getInternalAddressByIndex(0))).rejects.toThrow(
        'separation',
      );

      conflict = buildParent(false, 998000n); // Different body spending the shared ancestor.
      expect(conflict.getId()).not.toBe(funding.getId());
      await core.rpc('sendrawtransaction', [conflict.toHex()]);
      const conflictBlocks = await core.rpc('generatetoaddress', [6, miner]);
      conflictBlock = await core.rpc('getblock', [conflictBlocks[0]]);
      blockHeader = await core.rpc('getblockheader', [conflictBlocks[0], false]);
      expect(conflictBlock.tx).toHaveLength(2);
      expect(conflictBlock.tx[1]).toBe(conflict.getId());
      verifyFundingConflict(
        funding,
        {
          rawTransaction: conflict.toHex(),
          header: blockHeader,
          position: 1,
          merkle: [conflictBlock.tx[0]],
        },
        {
          height: conflictBlock.height + offset,
          blockHash: conflictBlock.hash,
          tipHeight: (await core.rpc('getblockcount')) + offset,
          txCount: 2,
        },
      );

      const { psbt: request } = await watch.createStandardHardwareTransaction(coins, targets, 2, watch._getInternalAddressByIndex(0));
      expect(request.data.inputs[0].sighashType).toBe(1);
      expect(Buffer.from(request.data.inputs[0].bip32Derivation![0].masterFingerprint).toString('hex')).toBe('73c5da0a');
      const returned = request.clone();
      returned.signInput(0, key); // Simulated stock device; no private key in RedWallet watch-only instance.
      const decoder = new BlueURDecoder();
      for (const part of encodeUR(returned.toHex(), 80, null, 'URv2').reverse()) decoder.receivePart(part.toUpperCase());
      expect(decoder.isComplete()).toBe(true);
      const signed = watch.combinePsbt(request, decoder.toString());
      const hex = signed.toHex();
      expect(signed.ins[0].witness[0].at(-1)).toBe(1);
      assertStandardHardwareResult(hex, request);
      const xbtAcceptance = (await knots.rpc('testmempoolaccept', [[hex]]))[0];
      const btcRejection = (await core.rpc('testmempoolaccept', [[hex]]))[0];
      const parentReplayRejection = (await core.rpc('testmempoolaccept', [[sameBodyStandard.toHex()]]))[0];
      expect(xbtAcceptance.allowed).toBe(true);
      expect(btcRejection.allowed).toBe(false);
      expect(parentReplayRejection.allowed).toBe(false);
      const altered = signed.clone();
      altered.outs[0].value += 1n;
      expect((await knots.rpc('testmempoolaccept', [[altered.toHex()]]))[0].allowed).toBe(false);
      // Exercise the production separation recheck after signing, with an
      // actual node reorg removing the confirmed conflicting spend.
      await core.rpc('invalidateblock', [conflictBlocks[0]]);
      await expect(verifyPublicFundingSeparation([funding], () => {})).rejects.toThrow('separation');
      await core.rpc('reconsiderblock', [conflictBlocks[0]]);
      await verifyPublicFundingSeparation([funding], () => {});
      await knots.rpc('sendrawtransaction', [hex]);
      const settled = await knots.rpc('generatetoaddress', [2, xbtMiner]);
      const final = await knots.rpc('getrawtransaction', [signed.getId(), true, settled[0]]);
      expect(final.confirmations).toBe(2);
      expect(final.hex).toBe(hex);
      receipt = {
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
        harnessSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
        versions: { core: core.version, knots: knots.version },
        binarySha256: Object.fromEntries(
          [
            ['core', coreBinary!],
            ['knots', knotsBinary!],
          ].map(([label, binary]) => [label, createHash('sha256').update(readFileSync(binary)).digest('hex')]),
        ),
        sharedPreForkHeight: 149,
        sharedTip,
        xbtActivationHeight: 150,
        fundingTxid: funding.getId(),
        conflictTxid: conflict.getId(),
        signedTxid: signed.getId(),
        confirmedConflictHeight: conflictBlock.height,
        confirmations: final.confirmations,
        providerCalls,
        coreUnified,
        xbtAcceptance,
        btcRejection,
        parentReplayRejection,
        unseparatedFundingBlocked: true,
        reorgBeforeBroadcastBlocked: true,
        sameBodyStandardAcceptedBeforeConflict: true,
        unifiedFlagCannotBeAppended: true,
        alteredAmountRejected: true,
        qrRoundTrip: 'URv2, reordered',
        limitations:
          'Simulated hardware with public test seed. Explorer URLs adapted to one local Core node with height offset; no TLS/independent provider qualification. No native UI, physical Keystone, mainnet broadcast, or production Electrum transport tested.',
        observedAt: new Date().toISOString(),
      };
    } finally {
      global.fetch = originalFetch;
      jest.restoreAllMocks();
      const cleanup = await Promise.allSettled([core.stop(), knots.stop()]);
      expect(cleanup.filter(result => result.status === 'rejected')).toEqual([]);
      if (receipt) {
        const destination = process.env.REDWALLET_STANDARD_REGTEST_ARTIFACT_DIR || 'artifacts/standard-hardware-regtest';
        mkdirSync(destination, { recursive: true });
        writeFileSync(path.join(destination, 'receipt.json'), JSON.stringify({ ...receipt, cleanupComplete: true }, null, 2) + '\n');
      }
    }
  },
  240000,
);
