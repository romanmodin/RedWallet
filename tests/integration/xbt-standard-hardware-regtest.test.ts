/**
 * Disposable shared-history regtest qualification for standard XBT signing.
 * Public BIP39 vector only. No configured node, real coin or physical signer.
 * RPC uses fresh directories, loopback ports and no peers.
 */
import assert from 'assert';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
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
import { DisposableNode } from '../helpers/standard-hardware-node';
import { StandardHardwareElectrumFixture } from '../helpers/standard-hardware-electrum';

const mockPreferences = new Map<string, string>();
jest.mock('react-native-default-preference', () => ({
  __esModule: true,
  default: {
    setName: jest.fn(),
    get: jest.fn(async (key: string) => mockPreferences.get(key)),
    set: jest.fn(async (key: string, value: string) => {
      mockPreferences.set(key, value);
    }),
    clear: jest.fn(async (key: string) => {
      mockPreferences.delete(key);
    }),
  },
}));

// Only the runtime release switch is bypassed in this opt-in test.
jest.mock('../../class/xbt/standard-hardware', () => ({
  ...jest.requireActual('../../class/xbt/standard-hardware'),
  assertStandardHardwareReleased: jest.fn(),
}));

const coreBinary = process.env.REDWALLET_BTC_REGTEST_BITCOIND;
const knotsBinary = process.env.REDWALLET_XBT_REGTEST_BITCOIND;
const fulcrumBinary = process.env.REDWALLET_XBT_REGTEST_FULCRUM;
const real = coreBinary && knotsBinary && fulcrumBinary ? test : test.skip;
const seed = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const originalFetch = global.fetch;
const offset = 961640 - 150;
const checkpoint = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';

real(
  'standard cold signatures work on separated XBT coins and cannot replay on the conflicting SHA-256 branch',
  async () => {
    const core = new DisposableNode();
    const knots = new DisposableNode();
    const transport = new StandardHardwareElectrumFixture(offset);
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

      await transport.start(fulcrumBinary!, knots);
      // Real TLS authentication must precede all wallet queries.
      expect(await BlueElectrum.testConnection('127.0.0.1', undefined, transport.port)).toBe(false);
      expect(transport.tlsConnections).toBe(0);
      expect(transport.counts).toEqual({});
      mockPreferences.set(BlueElectrum.ELECTRUM_HOST, '127.0.0.1');
      mockPreferences.set(BlueElectrum.ELECTRUM_SSL_PORT, String(transport.port));
      mockPreferences.set(BlueElectrum.ELECTRUM_TLS_CA, transport.ca);
      mockPreferences.set('electrum_default_server_declined', '1');
      await BlueElectrum.setDisabled(false);
      expect(await BlueElectrum.ensureConnected()).toBe(true);
      expect(transport.tlsConnections).toBeGreaterThan(0);
      expect(transport.checkpointRequests).toBeGreaterThan(0);

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
      // Production Electrum readers, verifier and broadcast are unmocked.
      // The TLS adapter only presents mainnet checkpoint/height labels while
      // forwarding history, raw transactions and submission to real Fulcrum.

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
      await expect(watch.broadcastTx(hex)).rejects.toThrow('separation');
      expect(transport.broadcasts).toEqual([]);
      await core.rpc('reconsiderblock', [conflictBlocks[0]]);
      await verifyPublicFundingSeparation([funding], () => {});
      // A failed fresh tip must not authorize using a cached mature height.
      transport.tipFailure = true;
      await expect(watch.broadcastTx(hex)).rejects.toMatchObject({
        message: 'fixture tip unavailable',
      });
      expect(transport.broadcasts).toEqual([]);
      transport.tipFailure = false;

      // Replace the real TLS connection during proof work: the approved body
      // must not be submitted on either the old or replacement connection.
      const explorer = global.fetch as jest.Mock;
      const localExplorer = explorer.getMockImplementation()!;
      let reconnected: Promise<boolean> | undefined;
      explorer.mockImplementationOnce(async (...args: any[]) => {
        BlueElectrum.forceDisconnect();
        transport.disconnect();
        reconnected = BlueElectrum.ensureConnected();
        expect(await reconnected).toBe(true);
        return localExplorer(...args);
      });
      await expect(watch.broadcastTx(hex)).rejects.toThrow('connection changed');
      expect(await reconnected).toBe(true);
      expect(transport.broadcasts).toEqual([]);

      // Retry uses current proof and the unchanged reviewed bytes over real TLS.
      await expect(watch.broadcastTx(hex)).resolves.toBe(true);
      expect(transport.broadcasts).toEqual([hex]);
      await expect(watch.broadcastTx(hex)).rejects.toThrow('verified signing request');
      expect(transport.broadcasts).toHaveLength(1);
      const settled = await knots.rpc('generatetoaddress', [2, xbtMiner]);
      const final = await knots.rpc('getrawtransaction', [signed.getId(), true, settled[0]]);
      expect(final.confirmations).toBe(2);
      expect(final.hex).toBe(hex);
      receipt = {
        sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
          encoding: 'utf8',
        }).trim(),
        harnessSha256: createHash('sha256').update(readFileSync(__filename)).digest('hex'),
        trackedChangesPresent: execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() !== '',
        sourceFilesSha256: Object.fromEntries(
          [
            'tests/integration/xbt-standard-hardware-regtest.test.ts',
            'tests/helpers/standard-hardware-electrum.ts',
            'tests/helpers/standard-hardware-node.ts',
            'blue_modules/BlueElectrum.ts',
            'class/wallets/watch-only-wallet.ts',
            'class/xbt/standard-hardware.ts',
            'class/xbt/separation-proof.ts',
            'class/xbt/separation-service.ts',
            'node_modules/electrum-client/index.js',
            'node_modules/electrum-client/lib/client.js',
          ].map(file => [file, createHash('sha256').update(readFileSync(file)).digest('hex')]),
        ),
        versions: { core: core.version, knots: knots.version },
        binarySha256: Object.fromEntries(
          [
            ['core', coreBinary!],
            ['knots', knotsBinary!],
            ['fulcrum', fulcrumBinary!],
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
        productionElectrumTransport: {
          tlsAuthenticated: true,
          untrustedCertificateRejectedBeforeQueries: true,
          freshTipFailureBlocked: true,
          replacedConnectionBlocked: true,
          duplicateSubmissionBlocked: true,
          broadcastCount: transport.broadcasts.length,
          tlsConnections: transport.tlsConnections,
          checkpointRequests: transport.checkpointRequests,
          methods: transport.counts,
          adapter: 'Loopback TLS to real Fulcrum; mainnet checkpoint and height labels adapted, transaction bytes unchanged',
        },
        limitations:
          'Simulated hardware with public test seed. Explorer URLs adapted to one local Core node with height offset; no independent explorer/TLS provider qualification. Electrum uses real Node TLS sockets, not the native mobile socket implementation. No native UI, physical Keystone or mainnet broadcast tested.',
        observedAt: new Date().toISOString(),
      };
    } finally {
      global.fetch = originalFetch;
      BlueElectrum.forceDisconnect();
      await BlueElectrum.setDisabled(true);
      jest.restoreAllMocks();
      const cleanup = await Promise.allSettled([transport.stop(), core.stop(), knots.stop()]);
      expect(transport.cleanupComplete).toBe(true);
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
