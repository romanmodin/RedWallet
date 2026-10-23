/** Offline stale initial-vote replay using real Kotlin fixtures and pinned Hermes. */
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
  for (const v of vectors)
    for (const fault of ['absent-caller', 'expired'])
      for (const order of ['arb', 'abr', 'bar', 'rab']) {
        const name = `${v.terms.script}-${v.terms.max_peers}-${v.mixes.length}-${fault}-${order}`;
        try {
          const started = v.startedAt + 2;
          let now = started,
            nonce = 0,
            publications = 0;
          const terms = { ...v.terms, creator: creatorPub } as Terms;
          const own = parseSeat(v.rawSeat, terms);
          const payloads = v.events.map(event => {
            const receiver = event.tags.find(t => t[0] === 'p')![1] === terms.public_key ? pool : join;
            return JSON.parse(decrypt(event.content, conversationKey(receiver, v.terms.creator)));
          });
          const round = await Round.join('synthetic-initial-history', terms.id, own.coins.map(outpoint), now + 7200, now, {
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
          const envelope = (body: unknown, recipient = terms.public_key, createdAt = now) =>
            signEvent(
              {
                kind: 2023,
                created_at: createdAt,
                tags: [['p', recipient]],
                content: encrypt(JSON.stringify(body), conversationKey(creator, recipient), Buffer.alloc(32, ++nonce)),
              },
              creator,
              Buffer.alloc(32, 7),
            );
          await session.receive(envelope(payloads[0], own.join_pub));
          if (fault === 'expired') now += 601;
          const stale = envelope(
            { ...payloads[2], vote_id: 'aa'.repeat(8), ...(fault === 'absent-caller' ? { by: 'ff'.repeat(32) } : {}) },
            terms.public_key,
            started,
          );
          const events = {
            a: stale,
            r: envelope(payloads[1]),
            b: envelope({ ...payloads[2], vote_id: 'bb'.repeat(8) }),
          };
          for (const step of order) {
            await session.receive(events[step as keyof typeof events]);
            check(session.snapshot().voteId !== 'aa'.repeat(8), 'Ineligible initial vote activated');
            check(publications === 0 && JSON.stringify(round.snapshot()) === journal, 'Unexpected publication or reservation change');
          }
          check(session.snapshot().phase === 'voting' && session.snapshot().voteId === 'bb'.repeat(8), 'Valid initial vote blocked');
          check(session.snapshot().seats.length === terms.max_peers, 'Verified roster missing');
          check(session.snapshot().deadline === now + 600, 'Current vote deadline changed');
          check(Object.keys(session.snapshot().signatures).length === 0, 'Unexpected spending signature');
          await session.receive(envelope({ type: 'reopen', vote_id: 'aa'.repeat(8) }));
          check(session.snapshot().voteId === 'bb'.repeat(8), 'Unrelated cancellation changed active vote');
          check(publications === 0, 'Published without user action');
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
