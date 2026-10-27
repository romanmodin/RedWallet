/** Opt-in actual upstream Kotlin PoolSession interoperability over a test-only stdio relay. */
import { spawn, execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { isolatedNode } from './isolated-node';
import { loopbackRelay } from './loopback-relay';
import { Transaction, crypto as bitcoinCrypto } from 'bitcoinjs-lib';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { ECPairFactory } from 'ecpair';
import ecc from '../../../blue_modules/noble_ecc';
import { NostrEvent } from '../../../class/xbt/kilojoin/crypto';
import { parsePool, changeMessage } from '../../../class/xbt/kilojoin/protocol';
import { ParticipantSession } from '../../../class/xbt/kilojoin/session';
import { Round } from '../../../class/xbt/kilojoin/round';
import { parseSeat } from '../../../class/xbt/kilojoin/roster';
import { Coin, coinScript, ownershipMessage, outpoint, change, digest } from '../../../class/xbt/kilojoin/transaction';
const enabled = !!process.env.KILOJOIN_PEER_CLASSPATH && !!process.env.KILOJOIN_JAVA;
const receipts: unknown[] = [];
afterAll(() => {
  if (process.env.KILOJOIN_V5_RECEIPT)
    writeFileSync(
      process.env.KILOJOIN_V5_RECEIPT,
      JSON.stringify(
        {
          sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          allCasesPassed: receipts.length === 6,
          upstream: '08971c226f5c61cf32f861ecaa28bf5fa14c03ec',
          cases: receipts,
        },
        null,
        2,
      ),
    );
});
const ECPair = ECPairFactory(ecc);
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
(enabled ? test : test.skip).each([
  ['p2wpkh', 1, 2],
  ['p2tr', 1, 2],
  ['p2wpkh', 2, 5],
  ['p2tr', 2, 5],
  ['p2wpkh', 5, 1],
  ['p2tr', 5, 1],
] as const)(
  'Kilowallet v5 %s with %i mixed outputs and %i creator payments agrees with RedWallet transaction bytes',
  async (type, count, paymentCount) => {
    const backend = process.env.KILOJOIN_REGTEST_BIN ? await isolatedNode(process.env.KILOJOIN_REGTEST_BIN) : undefined;
    const funded: Coin[] = [1, 2].map(n => ({
      txid: n.toString().repeat(64),
      vout: 0,
      value: 100000,
      pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex'),
      type,
    }));
    try {
      backend?.fund(funded);
    } catch (error) {
      await backend?.close();
      throw error;
    }
    const peer = spawn(
      process.env.KILOJOIN_JAVA!,
      [
        '-cp',
        process.env.KILOJOIN_PEER_CLASSPATH!,
        'kilojoin.test.PeerV5Kt',
        type,
        String(count),
        String(paymentCount),
        ...(backend ? [JSON.stringify({ coin: funded[1], cli: [backend.cli, ...backend.common] })] : []),
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stderr = '',
      failure: unknown,
      listing: NostrEvent | undefined,
      session: ParticipantSession | undefined,
      upstreamRaw: string | undefined;
    let transport: Awaited<ReturnType<typeof loopbackRelay>> | undefined;
    peer.stderr.on('data', data => {
      stderr = (stderr + data.toString()).slice(-10000);
    });
    peer.on('error', error => {
      failure = error;
    });
    const lines = createInterface({ input: peer.stdout });
    const now = () => Math.floor(Date.now() / 1000);
    const join = secret(10),
      joinPub = Buffer.from(ecc.pointFromScalar(join, true)!.slice(1)).toString('hex');
    lines.on('line', line => {
      try {
        const item = JSON.parse(line);
        if (item.broadcast) upstreamRaw = item.broadcast;
        const event = item.event as NostrEvent | undefined;
        if (!event) return;
        if (event.kind === 32022) {
          listing ??= event;
          return;
        }
        transport?.forward(event);
      } catch (error) {
        failure ??= error;
      }
    });
    async function until(check: () => boolean, timeout = 70000) {
      const deadline = Date.now() + timeout;
      while (!check()) {
        if (failure) throw failure;
        if (peer.exitCode !== null) throw new Error('Kotlin exited: ' + stderr);
        if (Date.now() >= deadline) throw new Error('Round timeout: ' + JSON.stringify(session?.snapshot()) + '\n' + stderr);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (failure) throw failure;
    }
    try {
      await until(() => !!listing);
      const terms = parsePool(listing!, now(), true);
      const c = funded[0];
      const output = (n: number) =>
        coinScript({
          ...c,
          pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex'),
        }).toString('hex');
      const own = parseSeat(
        {
          coin: c,
          token_hash: '00'.repeat(32),
          change_script: output(3),
          change_value: change(100000, 10000, 2, 1, type, count),
          join_pub: joinPub,
          proofs: [Buffer.from(ecc.signDER(ownershipMessage(terms.id, joinPub, c), secret(1))).toString('hex')],
        },
        terms,
      );
      const round = await Round.join('public-fixture', terms.id, [outpoint(c)], terms.timeout, now(), { save: async () => {} });
      session = new ParticipantSession(
        terms,
        own,
        join,
        Array.from({ length: count }, (_, i) => output(20 + i)),
        1000,
        round,
        {
          now,
          random: randomBytes,
          saveEncrypted: async () => {},
          walletOutpoints: () => new Set([outpoint(c)]),
          observe: async coins =>
            new Map(
              coins.map(coin => {
                const utxo = backend?.rpc('gettxout', [coin.txid, coin.vout]);
                return [
                  outpoint(coin),
                  backend
                    ? { value: Math.round(utxo.value * 1e8), script: utxo.scriptPubKey.hex, unspent: true, checkedAt: now() }
                    : { value: coin.value, script: coinScript(coin).toString('hex'), unspent: true, checkedAt: now() },
                ];
              }),
            ),
          publish: (event, isolated) => transport!.publish(event, isolated),
        },
      );
      transport = await loopbackRelay(
        async event => {
          const before = session!.snapshot().phase;
          try {
            await session!.receive(event);
          } catch (error) {
            failure ??= error;
            throw error;
          }
          if (before === 'joining' && session!.snapshot().phase === 'open')
            transport!.relay.subscribe([terms.creator, terms.public_key], [terms.public_key], now() - 60);
        },
        event => {
          peer.stdin.write(JSON.stringify(event) + '\n');
        },
        error => {
          failure ??= error;
        },
      );
      transport.relay.subscribe([terms.creator], [joinPub], now() - 60);
      const proof = Buffer.from(ecc.signDER(changeMessage(terms.id, [c], own.change_script, own.change_value), secret(1))).toString('hex');
      await session.sendJoin(proof);
      await until(() => session!.snapshot().phase === 'open' && session!.snapshot().seats.length === 2);
      await session.requestClose();
      await until(() => !!session!.snapshot().outputNotBefore);
      while (session.snapshot().phase === 'closing') {
        await until(() => now() >= session!.snapshot().outputNotBefore!);
        await session.submitOutput();
        if (!session.snapshot().outputNotBefore) break;
      }
      await until(() => session!.snapshot().phase === 'review');
      expect(round.snapshot().phase).toBe('review');
      expect(upstreamRaw).toBeUndefined();
      await session.signApproved(session.reviewed().commitment!, async p => {
        const index = p.coins.findIndex(coin => outpoint(coin) === outpoint(c));
        const internal = ecc.pointFromScalar(secret(1), true)!.slice(1);
        const sig =
          type === 'p2wpkh'
            ? ecc.signDER(digest(p, index), secret(1))
            : ECPair.fromPrivateKey(secret(1)).tweak(bitcoinCrypto.taggedHash('TapTweak', internal)).signSchnorr!(digest(p, index));
        return new Map([[outpoint(c), Buffer.concat([sig, Buffer.from([0x21])]).toString('hex')]]);
      });
      await until(() => !!upstreamRaw);
      expect(session.completedTransaction()).toBe(upstreamRaw);
      expect(round.snapshot().phase).toBe('signed');
      expect(transport.connections()).toBe(count + 1);
      const tx = Transaction.fromHex(upstreamRaw!);
      expect(tx.outs.filter(o => o.value === 10000n)).toHaveLength(count);
      const paymentValues = Array.from({ length: paymentCount }, (_, i) =>
        i === paymentCount - 1 ? count * 10000 - 330 * (paymentCount - 1) : 330,
      );
      const paymentScripts = Array.from({ length: paymentCount }, (_, i) =>
        coinScript({ ...c, pubkey: Buffer.from(ecc.pointFromScalar(secret(30 + i), true)!).toString('hex') }).toString('hex'),
      );
      paymentScripts.forEach((script, i) =>
        expect(tx.outs.filter(o => Buffer.from(o.script).toString('hex') === script && o.value === BigInt(paymentValues[i]))).toHaveLength(
          1,
        ),
      );
      if (backend) {
        expect(backend.rpc('getrawtransaction', [tx.getId()])).toBe(upstreamRaw);
        backend.rpc('generatetoaddress', [1, backend.miner]);
        expect(backend.rpc('getrawtransaction', [tx.getId(), true]).confirmations).toBe(1);
      }
      receipts.push({
        type,
        outputsPerPerson: count,
        creatorPaymentCount: paymentCount,
        txid: tx.getId(),
        raw: upstreamRaw,
        exactBytesMatch: true,
        outputSocketCount: transport.connections() - 1,
        nodeAccepted: !!backend,
        confirmations: backend ? 1 : 0,
        peerNetworkingDisabled: !!backend,
        binarySha256: backend?.binarySha256,
      });
    } finally {
      await transport?.close();
      lines.close();
      peer.stdin.end();
      peer.kill('SIGTERM');
      await new Promise<void>(resolve => {
        if (peer.exitCode !== null) resolve();
        else peer.once('exit', () => resolve());
      });
      await backend?.close();
    }
  },
  150000,
);
