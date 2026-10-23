/** Offline creator-vote/new-roster ordering, using real Kotlin proof fixtures. */
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
const results: { name: string; ok: boolean; error?: string }[] = [];
async function run() {
  for (const v of vectors) {
    const cases = [
      ...['rv', 'vr'].map(order => ({ order, active: false })),
      ...(v.terms.max_peers === 5 ? ['rvc', 'rcv', 'vrc', 'vcr', 'crv', 'cvr'].map(order => ({ order, active: true })) : []),
    ];
    for (const { order, active } of cases) {
      const name = `${v.terms.script}-${v.terms.max_peers}-${v.mixes.length}-${active ? 'voting' : 'open'}-${order}`;
      try {
        const now = v.startedAt + 2;
        let nonce = 0,
          publications = 0;
        const terms = { ...v.terms, creator: creatorPub } as Terms;
        const own = parseSeat(v.rawSeat, terms);
        const payloads = v.events.map(event => {
          const receiver = event.tags.find(t => t[0] === 'p')![1] === terms.public_key ? pool : join;
          return JSON.parse(decrypt(event.content, conversationKey(receiver, v.terms.creator)));
        });
        const roster = payloads[1];
        const seats = roster.seats as { token_hash: string; join_pub: string }[];
        const creatorSeat = seats.find(s => s.join_pub === terms.public_key)!;
        // The constructor fixture carries a placeholder token; welcome installs
        // the actual creator-issued token. Identify our roster seat by join key.
        const newcomer = seats.find(s => s.join_pub !== own.join_pub && (terms.max_peers === 2 || s !== creatorSeat))!;
        const initial = seats.filter(s => s.join_pub === own.join_pub || (terms.max_peers === 5 && s === creatorSeat));
        check(!!newcomer && !!creatorSeat && initial.length < seats.length, 'Invalid roster fixture');
        const round = await Round.join('synthetic-roster-vote', terms.id, own.coins.map(outpoint), now + 7200, now, {
          save: async () => {},
        });
        const journal = JSON.stringify(round.snapshot());
        const session = new ParticipantSession(terms, own, join, v.mixes, 10000, round, {
          now: () => now,
          random: n => Buffer.alloc(n, 37),
          saveEncrypted: async () => {},
          walletOutpoints: () => new Set(own.coins.map(outpoint)),
          observe: async coins =>
            new Map(
              coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: now }]),
            ),
          publish: async () => {
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
        await receive(payloads[0], own.join_pub);
        await receive({ ...roster, seats: initial });
        check(session.snapshot().seats.length === initial.length, 'Initial roster not verified');
        if (active) await receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: creatorSeat.token_hash });
        const events: Record<string, unknown> = {
          r: { ...roster, seq: roster.seq + 1 },
          v: { type: 'vote_open', vote_id: 'bb'.repeat(8), by: newcomer.token_hash },
          c: { type: 'reopen', vote_id: 'aa'.repeat(8) },
        };
        let rosterSeen = false;
        for (const step of order) {
          await receive(events[step]);
          if (step === 'r') rosterSeen = true;
          if (!rosterSeen) check(session.snapshot().voteId !== 'bb'.repeat(8), 'Activated before updated roster');
          check(publications === 0 && JSON.stringify(round.snapshot()) === journal, 'Unexpected publication or journal change');
        }
        check(session.snapshot().phase === 'voting' && session.snapshot().voteId === 'bb'.repeat(8), 'Following vote lost');
        check(session.snapshot().seats.length === seats.length, 'Updated roster lost');
        check(session.snapshot().deadline === now + 600, 'Vote deadline changed');
        check(Object.keys(session.snapshot().signatures).length === 0, 'Unexpected spending signature');
        await session.cancel();
        results.push({ name, ok: true });
      } catch (error) {
        results.push({ name, ok: false, error: error instanceof Error ? error.message : 'Unknown' });
      }
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
