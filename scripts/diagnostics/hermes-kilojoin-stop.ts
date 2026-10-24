/** Actual Hermes cancellation failure matrix; public synthetic Kotlin fixtures,
 * injected storage/chain boundaries, no network or spending signer. */
import { ParticipantSession, SessionState } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms } from '../../class/xbt/kilojoin/protocol';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { coinScript, outpoint } from '../../class/xbt/kilojoin/transaction';
import { NostrEvent } from '../../class/xbt/kilojoin/crypto';
import vectors from '../../tests/unit/fixtures/kilojoin-kotlin-session.json';
declare function print(text: string): void;
function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function deferred() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { promise, resolve: release };
}
async function rejects(action: Promise<unknown>, message: string) {
  let error = '';
  try {
    await action;
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  check(error === message, 'Expected ' + message + ', received ' + (error || 'success'));
}
const modes = ['repeated', 'concurrent', 'encrypted-failure', 'journal-failure', 'welcome-pending', 'roster-pending'] as const;
const results: { name: string; ok: boolean; error?: string }[] = [];
async function run() {
  for (const v of vectors)
    for (const mode of modes) {
      const name = `${v.terms.script}-${v.terms.max_peers}-${v.mixes.length}-${mode}`;
      try {
        const terms = v.terms as Terms;
        const seat = parseSeat(v.rawSeat, terms);
        const now = v.startedAt + 2;
        const entered = deferred(),
          release = deferred();
        let encryptedFails = false,
          journalFails = false,
          holdSave = false,
          holdObserve = false;
        let persisted: SessionState | undefined;
        const round = await Round.join('synthetic-stop', terms.id, seat.coins.map(outpoint), now + 7200, now, {
          save: async () => {
            if (journalFails) throw new Error('Synthetic journal unavailable');
          },
        });
        const session = new ParticipantSession(terms, seat, Buffer.from('07'.padStart(64, '0'), 'hex'), v.mixes, 10000, round, {
          now: () => now,
          random: length => new Uint8Array(length).fill(37),
          saveEncrypted: async state => {
            if (holdSave) {
              entered.resolve();
              await release.promise;
            }
            if (encryptedFails) throw new Error('Synthetic encrypted storage unavailable');
            persisted = JSON.parse(JSON.stringify(state));
          },
          walletOutpoints: () => new Set(seat.coins.map(outpoint)),
          observe: async coins => {
            if (holdObserve) {
              entered.resolve();
              await release.promise;
            }
            return new Map(
              coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: now }]),
            );
          },
          publish: async () => {
            throw new Error('Offline cancellation must not publish');
          },
        });
        if (mode === 'welcome-pending') holdSave = true;
        const welcome = session.receive(v.events[0] as NostrEvent);
        if (mode === 'welcome-pending' || mode === 'roster-pending') {
          let pending = welcome;
          if (mode === 'roster-pending') {
            await welcome;
            holdObserve = true;
            pending = session.receive(v.events[1] as NostrEvent);
          }
          await entered.promise;
          let stopped = false;
          const stop = session.cancel().then(() => {
            stopped = true;
          });
          await Promise.resolve();
          await Promise.resolve();
          check(!stopped && round.snapshot().reserved.length === seat.coins.length, 'Stop released an active operation early');
          holdSave = false;
          holdObserve = false;
          release.resolve();
          await pending;
          await stop;
        } else {
          await welcome;
          if (mode === 'encrypted-failure') {
            encryptedFails = true;
            await rejects(session.cancel(), 'Session persistence failed');
            check(round.snapshot().phase === 'aborted' && round.snapshot().reserved.length === 0, 'Journal cancellation not durable');
            await rejects(session.receive(v.events[1] as NostrEvent), 'Session closed');
            encryptedFails = false;
            await session.cancel();
          } else if (mode === 'journal-failure') {
            journalFails = true;
            await rejects(session.cancel(), 'Synthetic journal unavailable');
            check(
              round.snapshot().phase === 'joined' && round.snapshot().reserved.length === seat.coins.length,
              'Failed journal released coins',
            );
            check(session.snapshot().phase === 'open', 'Failed journal changed session phase');
            journalFails = false;
            await session.cancel();
          } else if (mode === 'concurrent') {
            await Promise.all([session.cancel(), session.cancel(), session.cancel()]);
          } else {
            await session.cancel();
            await session.cancel();
          }
        }
        check(round.snapshot().phase === 'aborted' && round.snapshot().reserved.length === 0, 'Unsigned cancellation not complete');
        check(session.snapshot().phase === 'aborted' && persisted?.phase === 'aborted', 'Encrypted terminal state not saved');
        await rejects(session.receive(v.events[1] as NostrEvent), 'Session closed');
        check(Object.keys(session.snapshot().signatures).length === 0, 'Unexpected spending signature');
        results.push({ name, ok: true });
      } catch (error) {
        results.push({ name, ok: false, error: error instanceof Error ? error.message : String(error) });
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
run().catch(error => print(JSON.stringify({ fatal: String(error), results })));
