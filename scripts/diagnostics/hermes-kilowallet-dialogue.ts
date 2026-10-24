/** Offline, actual-VM interoperability check. All keys/coins are public synthetic
 * fixtures. The host replays this deterministic client to exchange messages with
 * the unmodified Kotlin creator in a separate process. No wallet or network. */
import ecc from '../../blue_modules/noble_ecc';
import { ParticipantSession } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms, changeMessage } from '../../class/xbt/kilojoin/protocol';
import { Coin, coinScript, ownershipMessage, outpoint, change } from '../../class/xbt/kilojoin/transaction';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { NostrEvent, decrypt, encrypt, signEvent, conversationKey, utf8Hash } from '../../class/xbt/kilojoin/crypto';

declare function print(text: string): void;
type Creator = {
  state: { terms: Terms; seats: unknown[]; phase: string; reg_outputs: unknown[]; creator_secret: string };
  events: NostrEvent[];
  members: unknown[];
};
type Fixture = {
  setup: Creator;
  now: number;
  type: Coin['type'];
  peers: number;
  outputs: number;
  stress?: boolean;
  replies: { requestHash: string; reply: Creator }[];
};
const fixture = (globalThis as unknown as { __fixture: Fixture }).__fixture;
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const pub = (n: number) => Buffer.from(ecc.pointFromScalar(secret(n), true)!.slice(1)).toString('hex');
const pending = new Error('Host exchange required');
let exchange = 0;
let entropy = 0;
let clock = fixture.now;
const phases: string[] = [];
const checks: string[] = [];
let active: ParticipantSession | undefined;
function check(condition: unknown, name: string): asserts condition {
  if (!condition) throw new Error(name);
  checks.push(name);
}
// This deterministic source is confined to the diagnostic bundle. Never use it
// for production keys. The counter guarantees fresh bytes across client actions.
function random(length: number): Uint8Array {
  const chunks: Buffer[] = [];
  while (chunks.length * 32 < length) chunks.push(utf8Hash('public-hermes-dialogue-fixture:' + entropy++));
  return Buffer.concat(chunks).subarray(0, length);
}
function bridge(request: unknown): Creator {
  const requestHash = utf8Hash(JSON.stringify(request)).toString('hex');
  const recorded = fixture.replies[exchange++];
  if (!recorded) {
    print(JSON.stringify({ pending: true, exchange, requestHash, request }));
    throw pending;
  }
  check(recorded.requestHash === requestHash, 'deterministic replay exchange ' + exchange);
  clock = Math.max(clock, ...recorded.reply.events.map(e => e.created_at));
  return recorded.reply;
}
async function run() {
  check(typeof (globalThis as { HermesInternal?: unknown }).HermesInternal !== 'undefined', 'actual Hermes VM');
  const { setup, type, peers, outputs } = fixture;
  const terms = setup.state.terms;
  const coins: Coin[] = (peers === 5 ? [1] : [1, 2]).map(n => ({
    txid: String(n).repeat(64),
    vout: 0,
    value: 35000000,
    type,
    pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex'),
  }));
  const script = (n: number) =>
    coinScript({ ...coins[0], pubkey: Buffer.from(ecc.pointFromScalar(secret(n), true)!).toString('hex') }).toString('hex');
  const seat = parseSeat(
    {
      token_hash: 'ab'.repeat(32),
      join_pub: pub(7),
      coin: coins[0],
      coins,
      change_script: script(8),
      change_value: change(
        coins.reduce((sum, c) => sum + c.value, 0),
        terms.denomination,
        terms.fee_rate,
        coins.length,
        type,
        outputs,
      )!,
      proofs: coins.map((c, i) => Buffer.from(ecc.signDER(ownershipMessage(terms.id, pub(7), c), secret(i + 1))).toString('hex')),
    },
    terms,
  );
  const round = await Round.join('synthetic', terms.id, coins.map(outpoint), clock + 7200, clock, { save: async () => {} });
  const published: { event: NostrEvent; isolated: boolean }[] = [];
  let observedUnspent = true;
  const mixes = Array.from({ length: outputs }, (_, i) => script(30 + i));
  const session = new ParticipantSession(terms, seat, secret(7), mixes, 10000, round, {
    now: () => clock,
    random,
    saveEncrypted: async () => {},
    walletOutpoints: () => new Set(coins.map(outpoint)),
    observe: async cs =>
      new Map(
        cs.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: observedUnspent, checkedAt: clock }]),
      ),
    publish: async (event, isolated) => {
      published.push({ event, isolated: !!isolated });
    },
  });
  active = session;
  const last = () => published[published.length - 1].event;
  await session.sendJoin(
    Buffer.from(ecc.signDER(changeMessage(terms.id, coins, seat.change_script, seat.change_value), secret(1))).toString('hex'),
  );
  const join = last();
  const reply = bridge({ state: setup.state, events: [join] });
  check(reply.state.seats.length === peers, 'creator accepted actual Hermes join');
  const responses = reply.events.filter(e => e.kind === 2023);
  check(responses.length === 3, 'creator sent welcome roster vote');
  const ordered = fixture.stress ? [responses[0], ...responses.slice(1).reverse()] : responses;
  for (const event of ordered) {
    await session.receive(event);
    phases.push(session.snapshot().phase);
  }
  check(phases.join(',') === 'open,open,voting', 'welcome roster vote accepted');
  check(session.snapshot().seats.length === peers, 'all participants retained');
  const replay = bridge({ state: reply.state, events: [join] });
  check(replay.state.seats.length === peers && replay.events.length === 0, 'creator rejected duplicate join');
  const welcome = JSON.parse(decrypt(responses[0].content, conversationKey(secret(7), terms.creator)));
  check(welcome.pool_secret === '2', 'short pool scalar decoded');
  const voting = bridge({ state: reply.state, events: responses });
  check(voting.state.phase === 'VOTING', 'creator entered voting');
  await session.vote(true);
  const closeReply = bridge({ state: voting.state, events: [last()], completeSeedVotes: peers === 5 });
  const closing = closeReply.events.find(e => e.kind === 2023);
  check(closing, 'creator accepted Hermes vote');
  await session.receive(closing);
  check(session.snapshot().phase === 'closing', 'closing and blinding accepted');
  phases.push(session.snapshot().phase);
  const creatorClosing = bridge({ state: closeReply.state, events: [closing] });
  check(creatorClosing.state.phase === 'CLOSING', 'creator entered closing');
  const blindReply = bridge({ state: creatorClosing.state, events: [last()] });
  const blindSignature = blindReply.events.find(e => e.kind === 2023);
  check(blindSignature, 'creator accepted Hermes blinded messages');
  await session.receive(blindSignature);
  let earlyRejected = false;
  try {
    await session.submitOutput();
  } catch (error) {
    earlyRejected = error instanceof Error && error.message === 'Output is not ready';
  }
  check(earlyRejected, 'output timing enforced');
  clock += 45;
  const beforeOutputs = published.length;
  await session.submitOutput();
  const handedIn = published.slice(beforeOutputs);
  check(handedIn.length === outputs, 'all own outputs handed in');
  check(
    handedIn.every(item => item.isolated),
    'every output requests isolated transport',
  );
  check(new Set(handedIn.map(item => item.event.pubkey)).size === outputs, 'fresh key for every output');
  check(
    handedIn.every(item => item.event.pubkey !== join.pubkey),
    'output identity differs from join',
  );
  const outputReply = bridge({ state: blindReply.state, events: handedIn.map(item => item.event) });
  check(outputReply.state.reg_outputs.length === outputs * 2, 'creator accepted all Hermes output credentials');
  let outputsEvent = outputReply.events.find(e => e.kind === 2023);
  if (peers === 5) {
    check(!outputsEvent && session.snapshot().phase === 'closing', 'waiting until all participants register outputs');
    check(setup.members.length === peers - 2, 'actual Kotlin seed participants retained');
    const completed = bridge({ state: outputReply.state, events: [], completeSeedOutputs: { members: setup.members, closing } });
    check(completed.state.reg_outputs.length === peers * outputs, 'all participants registered exact output count');
    outputsEvent = completed.events.filter(e => e.kind === 2023).slice(-1)[0];
  }
  check(outputsEvent, 'creator completed output list');
  if (fixture.stress) {
    // Fault injection remains authenticated as this synthetic creator; testing a
    // corrupt event signature alone would never reach transaction validation.
    const creatorSecret = Buffer.from(setup.state.creator_secret.padStart(64, '0'), 'hex');
    const body = JSON.parse(decrypt(outputsEvent.content, conversationKey(secret(2), terms.creator)));
    const scripts = body.scripts as string[];
    const faults = [
      { scripts: scripts.slice(1), error: 'Invalid outputs' },
      { scripts: scripts.map(s => (s === mixes[0] ? script(99) : s)), error: 'Own mixed output missing' },
      { scripts: scripts.map((s, i) => (i === 0 ? scripts[1] : s)), error: 'Duplicate output' },
    ];
    for (const fault of faults) {
      const event = signEvent(
        {
          kind: 2023,
          created_at: clock,
          tags: [['p', terms.public_key]],
          content: encrypt(
            JSON.stringify({ ...body, scripts: fault.scripts }),
            conversationKey(creatorSecret, terms.public_key),
            random(32),
          ),
        },
        creatorSecret,
        random(32),
      );
      let rejected = false;
      try {
        await session.receive(event);
      } catch (error) {
        rejected = error instanceof Error && error.message === fault.error;
      }
      check(rejected && session.snapshot().phase === 'closing', 'authenticated bad outputs rejected: ' + fault.error);
    }
  }
  await session.receive(outputsEvent);
  check(session.snapshot().phase === 'review', 'unsigned review reached');
  check(session.reviewSummary()?.count === outputs, 'own output count verified');
  check(session.reviewSummary()?.total === outputs * terms.denomination, 'own total verified');
  check(session.reviewSummary()?.change === seat.change_value, 'own change verified');
  phases.push(session.snapshot().phase);
  // Check the final approval boundary without supplying a spending signer.
  let signingCalls = 0;
  const prohibitedSigner = async () => {
    signingCalls++;
    throw new Error('Spending signing prohibited in this diagnostic');
  };
  let wrongReviewRejected = false;
  try {
    await session.signApproved('00'.repeat(32), prohibitedSigner);
  } catch (error) {
    wrongReviewRejected = error instanceof Error && error.message === 'Displayed review changed';
  }
  check(wrongReviewRejected && signingCalls === 0, 'changed review rejected before signer');
  observedUnspent = false;
  let spentRejected = false;
  try {
    await session.signApproved(session.reviewed().commitment!, prohibitedSigner);
  } catch (error) {
    spentRejected = error instanceof Error && error.message === 'Missing, stale or mismatched chain observation';
  }
  check(spentRejected && signingCalls === 0, 'spent inputs rejected before signer');
  check(session.snapshot().phase === 'review', 'negative checks did not sign or advance');
  print(
    JSON.stringify({
      ok: true,
      type,
      peers,
      outputs,
      stress: !!fixture.stress,
      phases,
      checks,
      exchanges: exchange,
      finalPhase: session.snapshot().phase,
    }),
  );
}
run().catch(error => {
  if (error !== pending) {
    print(
      JSON.stringify({
        ok: false,
        type: fixture.type,
        peers: fixture.peers,
        outputs: fixture.outputs,
        phase: active?.snapshot().phase,
        checks,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});
