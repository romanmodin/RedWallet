/** Offline overlapping creator-vote replay in app-pinned Hermes.
 * Public Kotlin fixtures, disposable keys, no network or spending-key access.
 */
import ecc from '../../blue_modules/noble_ecc';
import { conversationKey, decrypt, encrypt, signEvent } from '../../class/xbt/kilojoin/crypto';
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
const check = (ok: boolean, why: string) => {
  if (!ok) throw new Error(why);
};
const cases = ['abc', 'acb', 'bac', 'bca', 'cab', 'cba', 'abdxy', 'abxdy', 'dabxy', 'adbyx'];
const results: { name: string; ok: boolean; error?: string }[] = [];
async function run() {
  for (const v of vectors)
    for (const order of cases) {
      const name = `${v.terms.script}-${v.terms.max_peers}-${v.mixes.length}-${order}`;
      try {
        const now = v.startedAt + 2;
        let nonce = 0,
          publications = 0;
        const terms = { ...v.terms, creator: creatorPub } as Terms;
        const seat = parseSeat(v.rawSeat, terms);
        const payloads = v.events.map(event => {
          const receiver = event.tags.find(t => t[0] === 'p')![1] === terms.public_key ? pool : join;
          return JSON.parse(decrypt(event.content, conversationKey(receiver, v.terms.creator)));
        });
        const round = await Round.join('synthetic-overlap', terms.id, seat.coins.map(outpoint), now + 7200, now, { save: async () => {} });
        const journal = JSON.stringify(round.snapshot());
        const session = new ParticipantSession(terms, seat, join, v.mixes, 10000, round, {
          now: () => now,
          random: n => Buffer.alloc(n, 37),
          saveEncrypted: async () => {},
          walletOutpoints: () => new Set(seat.coins.map(outpoint)),
          observe: async coins =>
            new Map(
              coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: now }]),
            ),
          publish: async event => {
            const body = JSON.parse(decrypt(event.content, conversationKey(pool, terms.public_key)));
            check(body.type === 'blind', 'Unexpected publication');
            publications++;
          },
        });
        const receive = (body: unknown, recipient = terms.public_key) =>
          session.receive(
            signEvent(
              {
                kind: 2023,
                created_at: now,
                tags: [['p', recipient]],
                content: encrypt(JSON.stringify(body), conversationKey(creator, recipient), Buffer.alloc(32, ++nonce)),
              },
              creator,
              Buffer.alloc(32, 7),
            ),
          );
        await receive(payloads[0], seat.join_pub);
        await receive(payloads[1]);
        check(session.snapshot().seats.length === terms.max_peers, 'Roster not verified');
        const vote = payloads[2];
        const events: Record<string, unknown> = {
          a: vote,
          b: { ...vote, vote_id: 'bb'.repeat(8) },
          d: { ...vote, vote_id: 'dd'.repeat(8) },
          c: { type: 'reopen', vote_id: vote.vote_id },
          x: { type: 'reopen', vote_id: vote.vote_id },
          y: { type: 'reopen', vote_id: 'bb'.repeat(8) },
        };
        for (const step of order) await receive(events[step]);
        const surviving = order.includes('d') ? 'dd'.repeat(8) : 'bb'.repeat(8);
        check(session.snapshot().phase === 'voting' && session.snapshot().voteId === surviving, 'Following vote lost');
        check(session.snapshot().seats.length === terms.max_peers, 'Roster lost');
        const active = JSON.stringify(session.snapshot());
        await receive(events.a);
        await receive(events.c);
        check(JSON.stringify(session.snapshot()) === active, 'Old cycle changed current vote');
        check(publications === 0, 'Published without approval');
        check(JSON.stringify(round.snapshot()) === journal, 'Journal or reservations changed');
        check(Object.keys(session.snapshot().signatures).length === 0, 'Unexpected spending signature');
        await session.cancel();
        results.push({ name, ok: true });
      } catch (error) {
        results.push({ name, ok: false, error: error instanceof Error ? error.message : 'Unknown' });
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
