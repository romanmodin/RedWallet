/** Opt-in actual upstream Kotlin PoolSession interoperability over a test-only stdio relay. */
import { spawn } from 'child_process';
import { createInterface } from 'readline';
import { randomBytes } from 'crypto';
import { ECPairFactory } from 'ecpair';
import { crypto as bitcoinCrypto } from 'bitcoinjs-lib';
import ecc from '../../../blue_modules/noble_ecc';
import { NostrEvent } from '../../../class/xbt/kilojoin/crypto';
import { parsePool, changeMessage } from '../../../class/xbt/kilojoin/protocol';
import { ParticipantSession } from '../../../class/xbt/kilojoin/session';
import { Round } from '../../../class/xbt/kilojoin/round';
import { parseSeat } from '../../../class/xbt/kilojoin/roster';
import { Coin, coinScript, ownershipMessage, outpoint, change, digest } from '../../../class/xbt/kilojoin/transaction';
const enabled = !!process.env.KILOJOIN_PEER_CLASSPATH && !!process.env.KILOJOIN_JAVA;
const ECPair = ECPairFactory(ecc);
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
(enabled ? test : test.skip).each(['p2wpkh', 'p2tr'] as const)(
  'full upstream Kotlin v3 %s round agrees with RedWallet transaction bytes',
  async type => {
    const peer = spawn(process.env.KILOJOIN_JAVA!, ['-cp', process.env.KILOJOIN_PEER_CLASSPATH!, 'kilojoin.test.PeerKt', type], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '',
      failure: unknown,
      listing: NostrEvent | undefined,
      session: ParticipantSession | undefined,
      upstreamRaw: string | undefined;
    let incoming = Promise.resolve();
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
        if (!session || !event.tags.some(t => t[0] === 'p' && [joinPub, parsePool(listing!, now()).public_key].includes(t[1]))) return;
        incoming = incoming
          .then(async () => {
            if (session!.snapshot().phase === 'joining' && !event.tags.some(t => t[0] === 'p' && t[1] === joinPub)) return;
            await session!.receive(event);
          })
          .catch(error => {
            failure ??= error;
          });
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
      await incoming;
      if (failure) throw failure;
    }
    try {
      await until(() => !!listing);
      const terms = parsePool(listing!, now());
      const c: Coin = {
        txid: '11'.repeat(32),
        vout: 0,
        value: 50000,
        pubkey: Buffer.from(ecc.pointFromScalar(secret(1), true)!).toString('hex'),
        type,
      };
      const output = (n: number) =>
        coinScript({ ...c, pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex') }).toString('hex');
      const own = parseSeat(
        {
          coin: c,
          token_hash: '00'.repeat(32),
          change_script: output(3),
          change_value: change(50000, 10000, 2, 1, type),
          join_pub: joinPub,
          proofs: [Buffer.from(ecc.signDER(ownershipMessage(terms.id, joinPub, c), secret(1))).toString('hex')],
        },
        terms,
      );
      const round = await Round.join('public-fixture', terms.id, [outpoint(c)], terms.timeout, now(), { save: async () => {} });
      session = new ParticipantSession(terms, own, join, output(5), 400, round, {
        now,
        random: randomBytes,
        saveEncrypted: async () => {},
        walletOutpoints: () => new Set([outpoint(c)]),
        observe: async coins =>
          new Map(
            coins.map(coin => [
              outpoint(coin),
              { value: coin.value, script: coinScript(coin).toString('hex'), unspent: true, checkedAt: now() },
            ]),
          ),
        publish: async event => {
          peer.stdin.write(JSON.stringify(event) + '\n');
        },
      });
      const proof = Buffer.from(ecc.signDER(changeMessage(terms.id, [c], own.change_script, own.change_value), secret(1))).toString('hex');
      await session.sendJoin(proof);
      await until(() => session!.snapshot().phase === 'open' && session!.snapshot().seats.length === 2);
      await session.requestClose();
      await until(() => !!session!.snapshot().outputNotBefore);
      await until(() => now() >= session!.snapshot().outputNotBefore!);
      await session.submitOutput();
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
    } finally {
      lines.close();
      peer.stdin.end();
      peer.kill('SIGTERM');
      await new Promise<void>(resolve => {
        if (peer.exitCode !== null) resolve();
        else peer.once('exit', () => resolve());
      });
    }
  },
  150000,
);
