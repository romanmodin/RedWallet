import { randomBytes } from 'crypto';
import vectors from './fixtures/kilojoin-kotlin-session.json';
import { ParticipantSession } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms } from '../../class/xbt/kilojoin/protocol';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { Coin, coinScript, outpoint } from '../../class/xbt/kilojoin/transaction';
import { NostrEvent } from '../../class/xbt/kilojoin/crypto';

async function fixture(v: (typeof vectors)[number]) {
  let clock = v.startedAt;
  const terms = v.terms as Terms;
  const seat = parseSeat(v.rawSeat, terms);
  const round = await Round.join('synthetic', terms.id, seat.coins.map(outpoint), clock + 7200, clock, { save: async () => {} });
  const session = new ParticipantSession(terms, seat, Buffer.from('07'.padStart(64, '0'), 'hex'), v.mixes, 10000, round, {
    now: () => clock,
    random: randomBytes,
    saveEncrypted: async () => {},
    walletOutpoints: () => new Set(seat.coins.map(outpoint)),
    observe: async (cs: Coin[]) =>
      new Map(cs.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: clock }])),
    publish: async () => {},
  });
  return {
    session,
    round,
    advance: () => {
      clock += 45;
    },
  };
}

test.each(vectors)('processes actual Kotlin creator $terms.script / $mixes.length output exchange through closing', async v => {
  const { session, round } = await fixture(v);
  for (const event of v.events) await session.receive(event as NostrEvent);
  expect(session.snapshot().phase).toBe('voting');
  await session.vote(true);
  // Fresh blinding has new randomness; use the recorded real exchange only for the
  // pre-blinding phases. Full blind/output interop is run by the manual harness.
  await session.receive(v.closing as NostrEvent);
  expect(session.snapshot().phase).toBe('closing');
  expect(session.snapshot().seats).toHaveLength(v.terms.max_peers);
  expect(round.snapshot().reserved).toHaveLength(v.rawSeat.coins.length);
});

test.each(vectors)('replaying an actual Kotlin roster cannot change accepted state for $terms.script', async v => {
  const { session, round } = await fixture(v);
  await session.receive(v.events[0] as NostrEvent);
  await session.receive(v.events[1] as NostrEvent);
  const before = session.snapshot();
  await expect(session.receive(v.events[1] as NostrEvent)).rejects.toThrow('Replayed message');
  expect(session.snapshot()).toEqual(before);
  expect(round.snapshot().reserved).toHaveLength(v.rawSeat.coins.length);
});
