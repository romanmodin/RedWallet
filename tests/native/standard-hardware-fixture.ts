/**
 * Native simulator fixture: disposable shared-history Core/Knots/Fulcrum plus
 * loopback HTTPS explorer views. Public BIP39 vector only; never a real wallet.
 * Two explorer routes deliberately share one Core node: this does not qualify
 * independence of public providers or physical hardware signing.
 */
import assert from 'assert';
import { createServer, Server } from 'https';
import { readFileSync } from 'fs';
import { Duplex } from 'stream';
import path from 'path';
import * as bitcoin from 'bitcoinjs-lib';
import { BIP32Factory } from 'bip32';
import { mnemonicToSeedSync } from 'bip39';
import ecc from '../../blue_modules/noble_ecc';
import { signUnifiedP2wpkhInput, finalizeUnifiedP2wpkhInput } from '../../class/xbt/unified-psbt';
import { DisposableNode } from '../helpers/standard-hardware-node';
import { StandardHardwareElectrumFixture } from '../helpers/standard-hardware-electrum';

export const EXPLORER_PORT = 61770;
export const HEIGHT_OFFSET = 961640 - 150;
const CHECKPOINT = '00000000000000000001d82da6ecccf08e07afa383f9212b0e1b95cc72430c00';
const root = BIP32Factory(ecc).fromSeed(
  mnemonicToSeedSync('abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'),
);
const account = root.derivePath("m/84'/0'/0'");
export const PUBLIC_WATCH_ACCOUNT = '[73c5da0a/84h/0h/0h]' + account.neutered().toBase58();
const child = account.derivePath('0/0');
export const PUBLIC_RECEIVE_ADDRESS = bitcoin.payments.p2wpkh({
  pubkey: child.publicKey,
}).address!;
export const PUBLIC_RECIPIENT = bitcoin.payments.p2wpkh({
  pubkey: root.derivePath("m/84'/0'/1'/0/0").publicKey,
}).address!;

export class StandardHardwareNativeFixture {
  readonly core = new DisposableNode();
  readonly knots = new DisposableNode();
  readonly transport = new StandardHardwareElectrumFixture(HEIGHT_OFFSET);
  funding!: bitcoin.Transaction;
  sameBodyStandard!: bitcoin.Transaction;
  conflict!: bitcoin.Transaction;
  private ancestor!: bitcoin.Transaction;
  private ancestorIndex = 0;
  private conflictBlock: any;
  private header = '';
  private server?: Server;
  private sockets = new Set<Duplex>();
  private xbtMiner = '';
  proof: 'missing' | 'valid' | 'disagreement' | 'unavailable' = 'missing';
  readonly explorerRequests: { provider: string; endpoint: string }[] = [];
  cleanupComplete = false;

  async start(binaries: { core: string; knots: string; fulcrum: string }) {
    await this.core.start(binaries.core, false);
    await this.knots.start(binaries.knots, true);
    const miner = await this.core.rpc('getnewaddress', [], true);
    this.xbtMiner = await this.knots.rpc('getnewaddress', [], true);
    const script = bitcoin.address.toOutputScript(PUBLIC_RECEIVE_ADDRESS);
    await this.core.rpc('generatetoaddress', [101, miner], false, 120000);
    const ancestorId = await this.core.rpc(
      'sendtoaddress',
      [bitcoin.address.fromOutputScript(script, bitcoin.networks.regtest), 0.01],
      true,
    );
    await this.core.rpc('generatetoaddress', [48, miner], false, 120000);
    this.ancestor = bitcoin.Transaction.fromHex(await this.core.rpc('getrawtransaction', [ancestorId]));
    this.ancestorIndex = this.ancestor.outs.findIndex(out => Buffer.from(out.script).equals(Buffer.from(script)));
    assert(this.ancestorIndex >= 0 && this.ancestor.outs[this.ancestorIndex].value === 1000000n);
    for (let height = 1; height <= 149; height++) {
      const hash = await this.core.rpc('getblockhash', [height]);
      assert.equal(await this.knots.rpc('submitblock', [await this.core.rpc('getblock', [hash, 0])]), null);
    }
    assert.equal(await this.core.rpc('getbestblockhash'), await this.knots.rpc('getbestblockhash'));
    await this.knots.rpc('generatetoaddress', [1, this.xbtMiner]);
    assert.equal((await this.knots.rpc('getblockheader', [await this.knots.rpc('getbestblockhash'), false])).length, 328);

    const parent = (unified: boolean, value = 999000n) => {
      const p = new bitcoin.Psbt();
      p.addInput({
        hash: ancestorId,
        index: this.ancestorIndex,
        nonWitnessUtxo: this.ancestor.toBuffer(),
        witnessUtxo: this.ancestor.outs[this.ancestorIndex],
        sighashType: unified ? 0x21 : 1,
      });
      p.addOutput({ address: PUBLIC_RECEIVE_ADDRESS, value });
      if (unified) {
        signUnifiedP2wpkhInput(p, 0, child);
        finalizeUnifiedP2wpkhInput(p, 0, child.publicKey, (pubkey, hash, sig) => ecc.verify(hash, pubkey, sig));
      } else {
        p.signInput(0, child);
        p.finalizeAllInputs();
      }
      return p.extractTransaction();
    };
    this.funding = parent(true);
    this.sameBodyStandard = parent(false);
    assert.equal(this.funding.getId(), this.sameBodyStandard.getId());
    assert.equal((await this.core.rpc('testmempoolaccept', [[this.sameBodyStandard.toHex()]]))[0].allowed, true);
    assert.equal((await this.core.rpc('testmempoolaccept', [[this.funding.toHex()]]))[0].allowed, false);
    await this.knots.rpc('sendrawtransaction', [this.funding.toHex()]);
    await this.knots.rpc('generatetoaddress', [6, this.xbtMiner]);
    // Only the test host creates this conflict, with public disposable coins.
    // RedWallet neither splits coins nor holds this signing key.
    this.conflict = parent(false, 998000n);
    await this.core.rpc('generatetoaddress', [1, miner]);
    await this.core.rpc('sendrawtransaction', [this.conflict.toHex()]);
    const hashes = await this.core.rpc('generatetoaddress', [6, miner]);
    this.conflictBlock = await this.core.rpc('getblock', [hashes[0]]);
    this.header = await this.core.rpc('getblockheader', [hashes[0], false]);
    assert.equal(this.conflictBlock.tx.length, 2);
    assert.equal(this.conflictBlock.tx[1], this.conflict.getId());
    await this.transport.start(binaries.fulcrum, this.knots);
    this.server = createServer(
      {
        key: readFileSync(path.join(process.cwd(), 'tests/fixtures/tls/server.key')),
        cert: readFileSync(path.join(process.cwd(), 'tests/fixtures/tls/native.pem')),
      },
      (request, response) => {
        const run = async () => {
          assert.equal(request.method, 'GET');
          const match = /^\/(evidence|anchor)(\/.*)$/.exec(request.url || '');
          assert(match, 'Only local fixture explorer paths are allowed');
          const [, provider, endpoint] = match;
          this.explorerRequests.push({ provider, endpoint });
          if (this.proof === 'unavailable') {
            response.writeHead(503).end('fixture unavailable');
            return;
          }
          const value = await this.explorer(provider, endpoint);
          response.writeHead(200, {
            'Content-Type': 'text/plain',
            'Cache-Control': 'no-store',
          });
          response.end(value);
        };
        run().catch(() => {
          if (!response.headersSent) response.writeHead(500);
          response.end('fixture rejected request');
        });
      },
    );
    this.server.on('connection', socket => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(EXPLORER_PORT, '127.0.0.1', resolve);
    });
  }

  private async explorer(provider: string, endpoint: string): Promise<string> {
    if (endpoint === '/block-height/961640') return CHECKPOINT;
    if (endpoint === '/blocks/tip/height') return String((await this.core.rpc('getblockcount')) + HEIGHT_OFFSET);
    if (endpoint === '/tx/' + this.ancestor.getId() + '/outspend/' + this.ancestorIndex) {
      const block = await this.core.rpc('getblockheader', [this.conflictBlock.hash]);
      return JSON.stringify(
        this.proof === 'missing' || block.confirmations < 1
          ? { spent: false }
          : {
              spent: true,
              txid: this.conflict.getId(),
              status: {
                confirmed: true,
                block_height: this.conflictBlock.height + HEIGHT_OFFSET,
                block_hash: this.conflictBlock.hash,
              },
            },
      );
    }
    if (endpoint === '/tx/' + this.conflict.getId() + '/hex') return this.conflict.toHex();
    if (endpoint === '/tx/' + this.conflict.getId() + '/merkle-proof')
      return JSON.stringify({
        block_height: this.conflictBlock.height + HEIGHT_OFFSET,
        pos: 1,
        merkle: [this.conflictBlock.tx[0]],
      });
    if (endpoint === '/block-height/' + (this.conflictBlock.height + HEIGHT_OFFSET))
      return provider === 'anchor' && this.proof === 'disagreement'
        ? '0'.repeat(64)
        : await this.core.rpc('getblockhash', [this.conflictBlock.height]);
    if (endpoint === '/block/' + this.conflictBlock.hash + '/header') return this.header;
    if (endpoint === '/block/' + this.conflictBlock.hash)
      return JSON.stringify({
        id: this.conflictBlock.hash,
        height: this.conflictBlock.height + HEIGHT_OFFSET,
        tx_count: 2,
      });
    throw new Error('Unexpected explorer fixture path');
  }

  /** Simulated cold device; these public-vector private keys never enter the app. */
  sign(request: bitcoin.Psbt): bitcoin.Psbt {
    assert.equal(request.inputCount, 1);
    const input = request.txInputs[0];
    assert.equal(Buffer.from(input.hash).reverse().toString('hex'), this.funding.getId());
    assert.equal(input.index, 0);
    assert.equal(request.data.inputs[0].sighashType, 1);
    assert.equal(Buffer.from(request.data.inputs[0].nonWitnessUtxo!).toString('hex'), this.funding.toHex());
    const origin = request.data.inputs[0].bip32Derivation![0];
    assert.equal(Buffer.from(origin.masterFingerprint).toString('hex'), '73c5da0a');
    assert.equal(origin.path, "m/84'/0'/0'/0/0");
    assert.equal(Buffer.from(origin.pubkey).toString('hex'), Buffer.from(child.publicKey).toString('hex'));
    assert(request.txOutputs.some(out => out.address === PUBLIC_RECIPIENT && out.value === 100000n));
    const fee = 999000n - request.txOutputs.reduce((sum, out) => sum + out.value, 0n);
    assert(fee > 0n && fee < 5000n);
    const result = request.clone();
    result.signInput(0, child);
    return result;
  }

  async reorg(remove: boolean) {
    await this.core.rpc(remove ? 'invalidateblock' : 'reconsiderblock', [this.conflictBlock.hash]);
  }

  async settle(hex: string) {
    const transaction = bitcoin.Transaction.fromHex(hex);
    assert.equal(transaction.ins[0].witness[0].at(-1), 1);
    const btc = (await this.core.rpc('testmempoolaccept', [[hex]]))[0];
    const parent = (await this.core.rpc('testmempoolaccept', [[this.sameBodyStandard.toHex()]]))[0];
    assert.equal(btc.allowed, false);
    assert.equal(parent.allowed, false);
    const blocks = await this.knots.rpc('generatetoaddress', [2, this.xbtMiner]);
    const confirmed = await this.knots.rpc('getrawtransaction', [transaction.getId(), true, blocks[0]]);
    assert.equal(confirmed.hex, hex);
    assert.equal(confirmed.confirmations, 2);
    return {
      txid: transaction.getId(),
      confirmations: confirmed.confirmations,
      btcRejection: btc,
      parentReplayRejection: parent,
    };
  }

  async stop() {
    for (const socket of this.sockets) socket.destroy();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    const results = await Promise.allSettled([this.transport.stop(), this.core.stop(), this.knots.stop()]);
    assert(
      results.every(result => result.status === 'fulfilled'),
      'Isolated fixture cleanup failed',
    );
    this.cleanupComplete = true;
  }
}
