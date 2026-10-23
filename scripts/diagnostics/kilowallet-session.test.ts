// Manual offline interoperability harness. Run explicitly after compiling the Kotlin jar.
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import ecc from '../../blue_modules/noble_ecc';
import { ParticipantSession } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms, changeMessage } from '../../class/xbt/kilojoin/protocol';
import { Coin, coinScript, ownershipMessage, outpoint, change } from '../../class/xbt/kilojoin/transaction';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { NostrEvent, decrypt, conversationKey } from '../../class/xbt/kilojoin/crypto';
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const pub = (n: number) => Buffer.from(ecc.pointFromScalar(secret(n), true)!.slice(1)).toString('hex');
const run = (input: unknown) =>
  JSON.parse(
    execFileSync(
      'java',
      ['-cp', '/tmp/redwallet-kotlin-tools/session-harness.jar:/tmp/redwallet-kotlin-tools/json.jar', 'KilowalletSessionHarnessKt'],
      { input: JSON.stringify(input), timeout: 30000 },
    ).toString(),
  );
const vectors: unknown[] = [];
afterAll(() => {
  writeFileSync('/tmp/redwallet-actual-session-vectors.json', JSON.stringify(vectors, null, 2) + '\n');
});

test.each(['p2wpkh', 'p2tr'] as const)(
  'actual Kotlin creator accepts RedWallet join and replies for %s',
  async type => {
    for (const maxPeers of [2, 5])
      for (const outputs of [1, 2, 5]) {
        const amount = maxPeers === 5 ? 3000000 : 1000000;
        const setup = run({ command: 'setup', outputs, script: type, maxPeers, amount });
        const terms = setup.state.terms as Terms;
        const now = Math.floor(Date.now() / 1000);
        let clock = now;
        const coins: Coin[] = (maxPeers === 5 ? [1] : [1, 2]).map(n => ({
          txid: String(n).repeat(64),
          vout: 0,
          value: 35000000,
          type,
          pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex'),
        }));
        const script = (n: number) =>
          coinScript({ ...coins[0], pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex') }).toString('hex');
        const rawSeat = {
          token_hash: 'ab'.repeat(32),
          join_pub: pub(7),
          coin: coins[0],
          coins,
          change_script: script(8),
          change_value: change(
            coins.reduce((sum, coin) => sum + coin.value, 0),
            amount,
            1,
            coins.length,
            type,
            outputs,
          )!,
          proofs: coins.map((c, i) => Buffer.from(ecc.signDER(ownershipMessage(terms.id, pub(7), c), secret(i + 1))).toString('hex')),
        };
        const seat = parseSeat(rawSeat, terms);
        const round = await Round.join('synthetic', terms.id, coins.map(outpoint), now + 7200, now, { save: async () => {} });
        const published: NostrEvent[] = [];
        const mixes = Array.from({ length: outputs }, (_, i) => script(30 + i));
        const session = new ParticipantSession(terms, seat, secret(7), mixes, 10000, round, {
          now: () => clock,
          random: randomBytes,
          saveEncrypted: async () => {},
          walletOutpoints: () => new Set(coins.map(outpoint)),
          observe: async cs =>
            new Map(cs.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: clock }])),
          publish: async e => {
            published.push(e);
          },
        });
        await session.sendJoin(
          Buffer.from(ecc.signDER(changeMessage(terms.id, coins, seat.change_script, seat.change_value), secret(1))).toString('hex'),
        );
        const reply = run({ state: setup.state, events: published });
        expect(reply.state.seats).toHaveLength(maxPeers);
        const responses = reply.events.filter((e: NostrEvent) => e.kind === 2023);
        expect(responses).toHaveLength(3);
        const phases = [];
        for (const event of responses) {
          await session.receive(event);
          phases.push(session.snapshot().phase);
        }
        expect(phases).toEqual(['open', 'open', 'voting']);
        expect(session.snapshot().seats).toHaveLength(maxPeers);
        // The real creator ignores the same already-accepted join on relay replay.
        const replay = run({ state: reply.state, events: published });
        expect(replay.state.seats).toHaveLength(maxPeers);
        expect(replay.events).toHaveLength(0);
        const welcome = JSON.parse(decrypt(responses[0].content, conversationKey(secret(7), terms.creator)));
        expect(welcome.pool_secret).toBe('2');
        // Relay loopback lets the actual creator process its own vote/closing messages.
        const voting = run({ state: reply.state, events: responses });
        expect(voting.state.phase).toBe('VOTING');
        await session.vote(true);
        const closeReply = run({ state: voting.state, events: [published[published.length - 1]], completeSeedVotes: maxPeers === 5 });
        const closing = closeReply.events.find((e: NostrEvent) => e.kind === 2023);
        expect(closing).toBeDefined();
        await session.receive(closing);
        expect(session.snapshot().phase).toBe('closing');
        const creatorClosing = run({ state: closeReply.state, events: [closing] });
        expect(creatorClosing.state.phase).toBe('CLOSING');
        const blindReply = run({ state: creatorClosing.state, events: [published[published.length - 1]] });
        const blindSignature = blindReply.events.find((e: NostrEvent) => e.kind === 2023);
        expect(blindSignature).toBeDefined();
        await session.receive(blindSignature);
        clock += 45;
        const beforeOutputs = published.length;
        await session.submitOutput();
        const handedIn = published.slice(beforeOutputs);
        expect(handedIn).toHaveLength(outputs);
        const outputReply = run({ state: blindReply.state, events: handedIn });
        expect(outputReply.state.reg_outputs).toHaveLength(outputs * 2);
        const outputsEvent = outputReply.events.find((e: NostrEvent) => e.kind === 2023);
        if (maxPeers === 2) {
          expect(outputsEvent).toBeDefined();
          await session.receive(outputsEvent);
          expect(session.snapshot().phase).toBe('review');
          expect(session.reviewSummary()?.count).toBe(outputs);
        } else {
          // Other seeded participants have voted, but have not handed in outputs.
          expect(outputsEvent).toBeUndefined();
          expect(session.snapshot().phase).toBe('closing');
        }
        vectors.push({
          terms,
          rawSeat,
          mixes,
          startedAt: now,
          events: responses,
          expectedPhases: phases,
          closing,
          blindSignature,
          outputsEvent,
        });
      }
  },
  120000,
);
