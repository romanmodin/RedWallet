/** Offline upstream-confirmed replay matrix in the actual app-pinned Hermes VM.
 * Public Kotlin fixtures and disposable keys only. No socket, native storage,
 * spending signer, or broadcast. Re-enveloping does not alter seat proofs.
 */
import ecc from '../../blue_modules/noble_ecc';
import { conversationKey, decrypt, encrypt, NostrEvent, signEvent } from '../../class/xbt/kilojoin/crypto';
import { ParticipantSession } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms } from '../../class/xbt/kilojoin/protocol';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { coinScript, outpoint } from '../../class/xbt/kilojoin/transaction';
import vectors from '../../tests/unit/fixtures/kilojoin-kotlin-session.json';

declare function print(text: string): void;
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const creator = secret(8),
  pool = secret(2),
  join = secret(7);
const creatorPub = Buffer.from(ecc.pointFromScalar(creator, true)!.slice(1)).toString('hex');
const results: { name: string; ok: boolean; error?: string; phase?: string; participants?: number }[] = [];
const check = (ok: boolean, error: string) => {
  if (!ok) throw new Error(error);
};
async function run() {
  for (const v of vectors)
    for (const reverse of [false, true]) {
      const name = `${v.terms.script}-${v.terms.max_peers}-${v.mixes.length}-${reverse ? 'reverse' : 'forward'}`;
      let session: ParticipantSession | undefined;
      try {
        const now = v.startedAt + 2;
        const terms = { ...v.terms, creator: creatorPub } as Terms;
        const seat = parseSeat(v.rawSeat, terms);
        let nonce = 0,
          observed = 0,
          writes = 0;
        const envelope = (body: unknown, sender = creator, recipient = terms.public_key, plaintext?: string, at = now): NostrEvent =>
          signEvent(
            {
              kind: 2023,
              created_at: at,
              tags: [['p', recipient]],
              content: encrypt(plaintext ?? JSON.stringify(body), conversationKey(sender, recipient), Buffer.alloc(32, ++nonce)),
            },
            sender,
            Buffer.alloc(32, 7),
          );
        const payloads = v.events.map(event => {
          const receiver = event.tags.find(t => t[0] === 'p')![1] === terms.public_key ? pool : join;
          return JSON.parse(decrypt(event.content, conversationKey(receiver, v.terms.creator)));
        });
        const round = await Round.join('synthetic-replay', terms.id, seat.coins.map(outpoint), now + 7200, now, { save: async () => {} });
        session = new ParticipantSession(terms, seat, join, v.mixes, 10000, round, {
          now: () => now,
          random: n => Buffer.alloc(n, 37),
          saveEncrypted: async () => {
            writes++;
          },
          walletOutpoints: () => new Set(seat.coins.map(outpoint)),
          observe: async coins => {
            observed++;
            return new Map(
              coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: now }]),
            );
          },
          publish: async () => {
            throw new Error('No offline publication authorized');
          },
        });
        // An early roster is unreadable until welcome; subscription replay restores it.
        await session.receive(envelope(payloads[1]));
        check(session.snapshot().phase === 'joining' && writes === 0, 'Early channel event changed state');
        const welcome = envelope(payloads[0], creator, seat.join_pub);
        await session.receive(welcome);
        await session.receive(welcome);
        const noise = [
          ...['vote_open', 'reopen', 'closing', 'blind_sig', 'outputs', 'abort'].map(type =>
            envelope({ type }, creator, terms.public_key, undefined, v.startedAt - 1),
          ),
          envelope({ type: 'roster', seq: 0, seats: [] }, creator, terms.public_key, undefined, v.startedAt - 7200),
          envelope(null, creator, terms.public_key, '{broken JSON'),
          envelope({ type: 'join' }, secret(6)),
          ...['close_request', 'vote', 'leave', 'blind', 'sig', 'tx', 'abort'].map(type => envelope({ type }, pool)),
          envelope({ type: 'outputs', round_id: 'aa'.repeat(8), scripts: [] }),
          envelope({ type: 'blind_sig', round_id: 'aa'.repeat(8), token_hash: seat.token_hash }),
        ];
        for (const event of noise) await session.receive(event);
        const current = payloads.slice(1).map(body => envelope(body));
        for (const event of reverse ? current.reverse() : current) {
          await session.receive(event);
          await session.receive(event);
        }
        await session.receive(envelope(payloads[1]));
        await session.receive(envelope(payloads[2]));
        check(session.snapshot().phase === 'voting', 'Did not reach voting');
        check(session.snapshot().seats.length === terms.max_peers, 'Participant count mismatch');
        check(observed === 1, 'Replayed roster re-observed coins');
        const accepted = JSON.stringify(session.snapshot());
        const bad = JSON.parse(JSON.stringify(payloads[1]));
        bad.seq++;
        const creatorSeat = bad.seats.find((s: { join_pub: string }) => s.join_pub === terms.public_key);
        check(!!creatorSeat, 'Missing actual Kotlin creator seat');
        creatorSeat.join_pub = terms.creator;
        let rejected = false;
        try {
          await session.receive(envelope(bad));
        } catch (error) {
          rejected = error instanceof Error && error.message === 'Invalid ownership proof';
        }
        check(rejected && JSON.stringify(session.snapshot()) === accepted, 'Invalid creator ownership changed state');
        check(round.snapshot().phase === 'joined', 'Journal advanced without approval');
        check(JSON.stringify(round.snapshot().reserved) === JSON.stringify(seat.coins.map(outpoint)), 'Reservations changed');
        check(Object.keys(session.snapshot().signatures).length === 0, 'Unexpected spending signature');
        results.push({ name, ok: true, phase: session.snapshot().phase, participants: session.snapshot().seats.length });
        await session.cancel();
      } catch (error) {
        results.push({ name, ok: false, error: error instanceof Error ? error.message : 'Unknown', phase: session?.snapshot().phase });
      }
    }
  print(
    JSON.stringify({
      hermes: typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined',
      passed: results.filter(r => r.ok).length,
      failed: results.filter(r => !r.ok).length,
      results,
    }),
  );
}
run().catch(error => print(JSON.stringify({ fatal: String(error) })));
