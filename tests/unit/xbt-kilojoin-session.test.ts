import { MixingClient } from '../../class/xbt/kilojoin/client';
import { coinjoinProgress } from '../../class/xbt/kilojoin/presentation';
import { participantFailure, relayFailureMessage } from '../../class/xbt/kilojoin/relay-error';
import { KilojoinRelay } from '../../class/xbt/kilojoin/relay';
import { generateKeyPairSync, randomBytes } from 'crypto';
import { ECPairFactory } from 'ecpair';
import { crypto as bitcoinCrypto, Transaction } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { ParticipantSession, SessionEnvironment } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms, tokenHash, changeMessage, memberMac } from '../../class/xbt/kilojoin/protocol';
import { Coin, coinScript, digest, outpoint, ownershipMessage, Plan, change, changeOf } from '../../class/xbt/kilojoin/transaction';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { conversationKey, decrypt, encrypt, hash, NostrEvent, signEvent } from '../../class/xbt/kilojoin/crypto';
import { modPow } from '../../class/xbt/kilojoin/blind-rsa';
const ECPair = ECPairFactory(ecc);
const secret = (n: number) => Buffer.from(n.toString(16).padStart(64, '0'), 'hex');
const pub = (key: Uint8Array) => Buffer.from(ecc.pointFromScalar(key, true)!.slice(1)).toString('hex');
const creator = secret(8),
  pool = secret(9),
  join = secret(10);
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ format: 'jwk' });
const n = BigInt('0x' + Buffer.from(rsa.n!, 'base64url').toString('hex'));
const d = BigInt('0x' + Buffer.from(rsa.d!, 'base64url').toString('hex'));
async function fixture(type: Coin['type'] = 'p2wpkh', outputs = 1, participants = 2, payments?: number[]) {
  let now = 10000,
    counter = 0;
  const script = (i: number) =>
    type === 'p2wpkh'
      ? '0014' + (participants === 2 ? i.toString(16).repeat(40) : i.toString(16).padStart(40, '0'))
      : '5120' + (participants === 2 ? i.toString(16).repeat(64) : i.toString(16).padStart(64, '0'));
  const terms: Terms = {
    v: payments ? 5 : outputs === 1 ? 3 : 4,
    ...(payments ? { payments, outputs } : {}),
    ...(outputs === 1 ? {} : { outputs }),
    app: 'kilowallet',
    network: 'blake2b',
    id: '0123456789abcdef',
    public_key: pub(pool),
    creator: pub(creator),
    blind_key: n.toString(16) + ':10001',
    denomination: 10000,
    fee_rate: 2,
    min_peers: 2,
    max_peers: Math.max(5, participants),
    max_inputs: 10,
    private: false,
    timeout: 12000,
    state: 'open',
    peers: participants,
    script: type,
  };
  const token = 'ab'.repeat(16),
    keys = Array.from({ length: participants }, (_, i) => secret(i + 1));
  const rawSeats = keys.map((key, i) => {
    const coin: Coin = {
      txid: (i + 1).toString(16).repeat(64),
      vout: 0,
      value: outputs === 1 ? 50000 : 100000,
      pubkey: Buffer.from(ecc.pointFromScalar(key, true)!).toString('hex'),
      type,
    };
    const joinPub = i === 0 ? pub(join) : participants === 2 || (payments && i === 1) ? pub(pool) : pub(secret(20 + i));
    return {
      coin,
      change_script: script(participants === 2 ? i + 3 : i + 100),
      change_value:
        payments && i === 1
          ? changeOf(coin.value, outputs * terms.denomination, terms.fee_rate, 1, type, payments.length)!
          : change(coin.value, terms.denomination, terms.fee_rate, 1, type, outputs)!,
      token_hash: i === 0 ? tokenHash(token) : participants === 2 ? 'cd'.repeat(32) : (i + 10).toString(16).padStart(64, '0'),
      join_pub: joinPub,
      proofs: [Buffer.from(ecc.signDER(ownershipMessage(terms.id, joinPub, coin), key)).toString('hex')],
    };
  });
  const own = parseSeat(rawSeats[0], terms),
    published: { event: NostrEvent; isolated: boolean }[] = [];
  const env: SessionEnvironment = {
    now: () => now,
    random: size => randomBytes(size),
    saveEncrypted: jest.fn(async () => {}),
    walletOutpoints: () => new Set([outpoint(own.coins[0])]),
    observe: async coins =>
      new Map(coins.map(c => [outpoint(c), { value: c.value, script: coinScript(c).toString('hex'), unspent: true, checkedAt: now }])),
    publish: async (event, isolated) => {
      published.push({ event, isolated });
    },
  };
  const round = await Round.join('wallet', terms.id, own.coins.map(outpoint), 12000, now, { save: async () => {} });
  const session = new ParticipantSession(
    terms,
    own,
    join,
    Array.from({ length: outputs }, (_, i) => script(5 + i)),
    outputs === 1 ? 400 : 1000,
    round,
    env,
  );
  const receive = async (body: Record<string, unknown>, direct = false, sender = creator, createdAt = now) => {
    const recipient = direct ? pub(join) : pub(pool);
    await session.receive(
      signEvent(
        {
          kind: 2023,
          created_at: createdAt,
          tags: [['p', recipient]],
          content: encrypt(JSON.stringify({ ...body, test_nonce: ++counter }), conversationKey(sender, recipient), randomBytes(32)),
        },
        sender,
        randomBytes(32),
      ),
    );
  };
  const advance = async (
    alter: (body: Record<string, unknown>) => Record<string, unknown> = body => body,
    alterOutputs: (body: Record<string, unknown>) => Record<string, unknown> = body => body,
  ) => {
    await receive({ type: 'welcome', pool_secret: pool.toString('hex'), token, seq: 1 }, true);
    await receive({ type: 'roster', seq: 1, seats: rawSeats });
    await receive({ type: 'closing', round_id: 'aa'.repeat(8), seats: rawSeats, deadline: now + 300 });
    const request = JSON.parse(decrypt(published[0].event.content, conversationKey(pool, pub(pool))));
    const blinded = outputs === 1 ? [request.blinded] : request.blinded;
    expect(blinded).toHaveLength(outputs);
    const sigs = blinded.map((b: string) =>
      modPow(BigInt('0x' + b), d, n)
        .toString(16)
        .padStart(512, '0'),
    );
    await receive(
      alter({
        type: 'blind_sig',
        round_id: request.round_id,
        token_hash: own.token_hash,
        ...(outputs === 1 ? { sig: sigs[0] } : { sigs }),
      }),
    );
    now += 45;
    await session.submitOutput();
    await receive(
      alterOutputs({
        type: 'outputs',
        round_id: request.round_id,
        scripts: Array.from({ length: outputs * (participants - (payments ? 1 : 0)) }, (_, i) => script(5 + i)),
        ...(payments ? { payments: payments.map((value, i) => ({ script: script(participants === 2 ? 10 + i : 1000 + i), value })) } : {}),
      }),
    );
  };
  const signature = (p: Plan, index: number) => {
    const key = keys[Number(p.coins[index].txid[0]) - 1];
    if (type === 'p2wpkh') return Buffer.concat([ecc.signDER(digest(p, index), key), Buffer.from([0x21])]).toString('hex');
    const internal = ecc.pointFromScalar(key, true)!.slice(1);
    const tweaked = ECPair.fromPrivateKey(key).tweak(bitcoinCrypto.taggedHash('TapTweak', internal));
    return Buffer.concat([tweaked.signSchnorr!(digest(p, index)), Buffer.from([0x21])]).toString('hex');
  };
  const tick = (seconds: number) => {
    now += seconds;
  };
  return { session, round, env, advance, receive, published, signature, rawSeats, terms, tick };
}
test.each([1, 2, 5])('accepts upstream BigInteger welcome key for %i mixed outputs', async outputs => {
  const f = await fixture('p2wpkh', outputs);
  // Kilowallet PoolSession stores poolSecret with BigInteger.toString(16).
  // It legitimately omits leading zeros and can contain an odd digit count.
  const wireSecret = BigInt('0x' + pool.toString('hex')).toString(16);
  await f.receive({ type: 'welcome', pool_secret: wireSecret, token: 'ab'.repeat(16), seq: 2 }, true);
  expect(f.session.snapshot().phase).toBe('open');
  expect(f.env.saveEncrypted).toHaveBeenCalledWith(expect.objectContaining({ poolSecret: pool.toString('hex') }));
  await f.receive({ type: 'roster', seq: 2, seats: f.rawSeats });
  expect(f.session.snapshot().seats).toHaveLength(2);
  expect(f.published).toHaveLength(0);
  expect(f.round.snapshot().phase).toBe('joined');
});

test.each([
  ['reject', 'creator-rejected', true],
  ['abort', 'creator-aborted', false],
] as const)('persists the exact creator terminal cause for %s', async (type, terminalCause, direct) => {
  const f = await fixture();
  if (!direct) await f.receive({ type: 'welcome', pool_secret: pool.toString('hex'), token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type, reason: 'untrusted private detail' }, direct);
  expect(f.session.snapshot()).toMatchObject({ phase: 'aborted', terminalCause });
  expect(f.round.snapshot()).toMatchObject({ phase: 'aborted', reserved: [] });
  expect(f.env.saveEncrypted).toHaveBeenLastCalledWith(expect.objectContaining({ phase: 'aborted', terminalCause }));
});

test.each(['p2wpkh', 'p2tr'] as const)('creator ownership binds to pool join_pub, never creator authority key: %s', async type => {
  const f = await fixture(type);
  expect(f.rawSeats[1].join_pub).toBe(f.terms.public_key);
  expect(f.terms.public_key).not.toBe(f.terms.creator);
  expect(() => parseSeat(f.rawSeats[1], f.terms)).not.toThrow();
  expect(() => parseSeat({ ...f.rawSeats[1], join_pub: f.terms.creator }, f.terms)).toThrow('Invalid ownership proof');
});

test.each([1, 5])('re-encrypted history after review cannot restart signing or output registration: %i outputs', async outputs => {
  const f = await fixture('p2wpkh', outputs);
  await f.advance();
  const state = f.session.snapshot(),
    journal = f.round.snapshot(),
    count = f.published.length;
  for (const body of [
    { type: 'roster', seq: 1, seats: f.rawSeats },
    { type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash },
    { type: 'reopen', vote_id: 'bb'.repeat(8) },
    { type: 'closing', round_id: state.roundId, seats: f.rawSeats, deadline: state.deadline },
    { type: 'blind_sig', round_id: state.roundId, token_hash: f.rawSeats[0].token_hash, sig: '00' },
    { type: 'outputs', round_id: state.roundId, scripts: state.outputs },
  ])
    await f.receive(body);
  expect(f.session.snapshot()).toEqual(state);
  expect(f.round.snapshot()).toEqual(journal);
  expect(f.published).toHaveLength(count);
  expect(f.session.snapshot().signatures).toEqual({});
});

test.each(['', '0', '00', 'a', '-9', '+9', '0x9', ' 9', '9 ', 'G', '9'.repeat(65), 'f'.repeat(64)])(
  'rejects malformed, out-of-range or wrong-pool welcome key %s',
  async wireSecret => {
    const f = await fixture();
    await expect(f.receive({ type: 'welcome', pool_secret: wireSecret, token: 'ab'.repeat(16), seq: 1 }, true)).rejects.toThrow();
    expect(f.session.snapshot().phase).toBe('joining');
    expect(f.env.saveEncrypted).not.toHaveBeenCalled();
    expect(f.published).toHaveLength(0);
  },
);

test('does not advance or install the welcome key when durable persistence fails', async () => {
  const f = await fixture();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('Persistence unavailable'));
  await expect(f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true)).rejects.toThrow(
    'Session persistence failed',
  );
  expect(f.session.snapshot().phase).toBe('joining');
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).resolves.toBeUndefined();
  expect(f.session.snapshot().phase).toBe('joining');
  expect(f.published).toHaveLength(0);
});

test('a pending initial vote cannot vote, publish, sign, or change reservations before a verified roster', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const before = f.session.snapshot();
  await f.receive({
    type: 'vote_open',
    by: f.rawSeats[1].token_hash,
    vote_id: 'aa'.repeat(8),
  });
  expect(f.session.snapshot()).toEqual(before);
  await expect(f.session.vote(true)).rejects.toThrow('phase');
  expect(f.published).toHaveLength(0);
  expect(f.round.snapshot().phase).toBe('joined');
  expect(f.round.snapshot().reserved).toHaveLength(1);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({
    phase: 'voting',
    deadline: 10600,
    voteId: 'aa'.repeat(8),
  });
  expect(f.published).toHaveLength(0);
});

test.each(['proof', 'chain', 'own-seat'] as const)('a pending initial vote never bypasses a failing %s check', async failure => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({
    type: 'vote_open',
    by: f.rawSeats[1].token_hash,
    vote_id: 'aa'.repeat(8),
  });
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'bb'.repeat(8) });
  const seats = JSON.parse(JSON.stringify(f.rawSeats));
  if (failure === 'proof') seats[1].proofs[0] = '00';
  if (failure === 'chain') f.env.observe = async () => new Map();
  if (failure === 'own-seat') seats[0].token_hash = 'ee'.repeat(32);
  await expect(f.receive({ type: 'roster', seq: 1, seats })).rejects.toThrow();
  expect(f.session.snapshot()).toMatchObject({
    phase: 'open',
    seats: [],
    sequence: 0,
  });
  expect(f.published).toHaveLength(0);
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test('initial vote caller must belong to the subsequently verified roster', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({
    type: 'vote_open',
    by: 'ff'.repeat(32),
    vote_id: 'aa'.repeat(8),
  });
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ phase: 'open', sequence: 1 });
  expect(f.session.snapshot().seats).toHaveLength(2);
  expect(f.session.snapshot().voteId).toBeUndefined();
  await expect(f.session.vote(true)).rejects.toThrow('phase');
  const signer = jest.fn();
  await expect(f.session.signApproved('00'.repeat(32), signer)).rejects.toThrow();
  expect(signer).not.toHaveBeenCalled();
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
});

test('conflicting initial vote identity fails closed without replacing the first authenticated request', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({
    type: 'vote_open',
    by: f.rawSeats[1].token_hash,
    vote_id: 'aa'.repeat(8),
  });
  await expect(
    f.receive({
      type: 'vote_open',
      by: f.rawSeats[0].token_hash,
      vote_id: 'aa'.repeat(8),
    }),
  ).rejects.toThrow('Conflicting initial vote identity');
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot().voteId).toBe('aa'.repeat(8));
  expect(f.published).toHaveLength(0);
});

test('a deferred vote keeps the original deadline and cannot become valid after its expiry', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({
    type: 'vote_open',
    by: f.rawSeats[1].token_hash,
    vote_id: 'aa'.repeat(8),
  });
  f.tick(601);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ phase: 'open', sequence: 1 });
  expect(f.session.snapshot().seats).toHaveLength(2);
  expect(f.session.snapshot().voteId).toBeUndefined();
  await expect(f.session.vote(true)).rejects.toThrow('phase');
  const signer = jest.fn();
  await expect(f.session.signApproved('00'.repeat(32), signer)).rejects.toThrow();
  expect(signer).not.toHaveBeenCalled();
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
});

test('durable roster/vote failure never partially advances a deferred vote', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({
    type: 'vote_open',
    by: f.rawSeats[1].token_hash,
    vote_id: 'aa'.repeat(8),
  });
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('private native error detail'));
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).rejects.toThrow('Session persistence failed');
  expect(f.session.snapshot()).toMatchObject({ phase: 'open', seats: [] });
  expect(f.published).toHaveLength(0);
  expect(f.round.snapshot().phase).toBe('joined');
});

async function pendingVotesFixture() {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'aa'.repeat(8) });
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'bb'.repeat(8) });
  return f;
}

const initialHistoryCases = (['p2wpkh', 'p2tr'] as const).flatMap(type =>
  [1, 5].flatMap(outputs =>
    ['absent-caller', 'expired'].flatMap(fault =>
      ['arb', 'abr', 'bar', 'bra', 'rab', 'rba'].map(order => ({ type, outputs, fault, order })),
    ),
  ),
);

test.each(initialHistoryCases)(
  'initial $fault vote history cannot block a valid roster and current vote: $type/$outputs/$order',
  async ({ type, outputs, fault, order }) => {
    const f = await fixture(type, outputs);
    await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
    const stale = signEvent(
      {
        kind: 2023,
        created_at: 10000,
        tags: [['p', f.terms.public_key]],
        content: encrypt(
          JSON.stringify({
            type: 'vote_open',
            vote_id: 'aa'.repeat(8),
            by: fault === 'absent-caller' ? 'ff'.repeat(32) : f.rawSeats[1].token_hash,
          }),
          conversationKey(creator, f.terms.public_key),
          randomBytes(32),
        ),
      },
      creator,
      randomBytes(32),
    );
    if (fault === 'expired') f.tick(601);
    const journal = f.round.snapshot();
    for (const step of order) {
      if (step === 'a') await f.session.receive(stale);
      if (step === 'r') await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
      if (step === 'b') await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
      expect(f.session.snapshot().voteId).not.toBe('aa'.repeat(8));
      expect(f.published).toHaveLength(0);
      expect(f.round.snapshot()).toEqual(journal);
    }
    expect(f.session.snapshot()).toMatchObject({
      phase: 'voting',
      voteId: 'bb'.repeat(8),
      sequence: 1,
      deadline: fault === 'expired' ? 11201 : 10600,
    });
    expect(f.session.snapshot().seats).toHaveLength(2);
    await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
    expect(f.session.snapshot().voteId).toBe('bb'.repeat(8));
    expect(f.published).toHaveLength(0);
  },
);

test.each(['p2wpkh', 'p2tr'] as const)('initial %s request remains inactive until a later roster establishes quorum', async type => {
  const f = await fixture(type, 5);
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
  await f.receive({ type: 'roster', seq: 1, seats: [f.rawSeats[0]] });
  expect(f.session.snapshot()).toMatchObject({ phase: 'open', sequence: 1 });
  await expect(f.session.vote(true)).rejects.toThrow('phase');
  expect(f.published).toHaveLength(0);
  await f.receive({ type: 'roster', seq: 2, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8), deadline: 10600 });
  expect(f.published).toHaveLength(0);
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test('failed first-roster save preserves both inactive history and the eligible initial request', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: 'ff'.repeat(32) });
  await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
  const before = f.session.snapshot();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('synthetic storage failure'));
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).rejects.toThrow('Session persistence failed');
  expect(f.session.snapshot()).toEqual(before);
  await expect(f.session.vote(true)).rejects.toThrow('phase');
  expect(f.published).toHaveLength(0);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8) });
  await f.receive({ type: 'reopen', vote_id: 'bb'.repeat(8) });
  expect(f.session.snapshot().phase).toBe('open');
  expect(f.session.snapshot().voteId).toBeUndefined();
  expect(f.published).toHaveLength(0);
});

test('failed initial roster persistence retains every pending cycle for a later authenticated envelope', async () => {
  const f = await pendingVotesFixture();
  const before = f.session.snapshot(),
    journal = f.round.snapshot();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('private synthetic storage error'));
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).rejects.toThrow('Session persistence failed');
  expect(f.session.snapshot()).toEqual(before);
  expect(f.round.snapshot()).toEqual(journal);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot().voteId).toBe('aa'.repeat(8));
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot().voteId).toBe('bb'.repeat(8));
  expect(f.published).toHaveLength(0);
});

test('failed pre-roster cancellation cannot remove a queued cycle until its save succeeds', async () => {
  const f = await pendingVotesFixture();
  const before = f.session.snapshot();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('private synthetic storage error'));
  await expect(f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) })).rejects.toThrow('Session persistence failed');
  expect(f.session.snapshot()).toEqual(before);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot().voteId).toBe('aa'.repeat(8));
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot().voteId).toBe('bb'.repeat(8));
  expect(f.published).toHaveLength(0);
});

test('pre-roster duplicates cannot extend either vote deadline or replace the active request', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'aa'.repeat(8) });
  f.tick(60);
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'bb'.repeat(8) });
  f.tick(40);
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'bb'.repeat(8) });
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ voteId: 'aa'.repeat(8), deadline: 10600 });
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot()).toMatchObject({ voteId: 'bb'.repeat(8), deadline: 10660 });
  expect(f.published).toHaveLength(0);
});

test.each(['unknown-caller', 'expired', 'wrong-authority'] as const)(
  'a queued initial cycle cannot bypass the %s check when promoted',
  async problem => {
    const f = await fixture();
    await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
    const sender = problem === 'wrong-authority' ? pool : creator;
    const following = signEvent(
      {
        kind: 2023,
        created_at: 10000,
        tags: [['p', f.terms.public_key]],
        content: encrypt(
          JSON.stringify({
            type: 'vote_open',
            by: problem === 'unknown-caller' ? 'ff'.repeat(32) : f.rawSeats[1].token_hash,
            vote_id: 'bb'.repeat(8),
          }),
          conversationKey(sender, f.terms.public_key),
          randomBytes(32),
        ),
      },
      sender,
      randomBytes(32),
    );
    // A is fresh; an older B envelope arrives second through replay.
    if (problem === 'expired') f.tick(601);
    await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'aa'.repeat(8) });
    await f.session.receive(following);
    await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
    expect(f.session.snapshot().voteId).toBe('aa'.repeat(8));
    await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
    expect(f.session.snapshot().phase).toBe('open');
    expect(f.session.snapshot().voteId).toBeUndefined();
    expect(f.published).toHaveLength(0);
    expect(f.round.snapshot().reserved).toHaveLength(1);
  },
);

test('pre-roster resource limit cannot replace retained votes or activate an unverified roster', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  for (let i = 1; i <= 32; i++)
    await f.receive({ type: 'vote_open', vote_id: i.toString(16).padStart(16, '0'), by: f.rawSeats[1].token_hash });
  const before = f.session.snapshot();
  await expect(f.receive({ type: 'vote_open', vote_id: 'ee'.repeat(8), by: f.rawSeats[1].token_hash })).rejects.toThrow(
    'Initial vote limit',
  );
  expect(f.session.snapshot()).toEqual(before);
  expect(before).toMatchObject({ phase: 'open', seats: [] });
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot().voteId).toBe('0000000000000001');
  await f.receive({ type: 'reopen', vote_id: '0000000000000001' });
  expect(f.session.snapshot().voteId).toBe('0000000000000002');
  expect(f.published).toHaveLength(0);
});

const reopenOrders = ['rvc', 'rcv', 'vrc', 'vcr', 'crv', 'cvr'];
const reopenCases = (['p2wpkh', 'p2tr'] as const).flatMap(type =>
  [1, 5].flatMap(outputs => reopenOrders.map(order => ({ type, outputs, order }))),
);
test.each(reopenCases)('cancelled vote stays cancelled for $type/$outputs replay $order', async ({ type, outputs, order }) => {
  const f = await fixture(type, outputs);
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const journal = f.round.snapshot();
  const vote = { type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash };
  const events: Record<string, Record<string, unknown>> = {
    r: { type: 'roster', seq: 1, seats: f.rawSeats },
    v: vote,
    c: { type: 'reopen', vote_id: vote.vote_id },
  };
  for (const step of order) await f.receive(events[step]);
  // New ciphertext and event IDs, at the same timestamp, must not revive an ended vote.
  await f.receive(vote);
  expect(f.session.snapshot()).toMatchObject({ phase: 'open', sequence: 1, deadline: 12000 });
  expect(f.session.snapshot().voteId).toBeUndefined();
  expect(f.session.snapshot().seats).toHaveLength(2);
  await expect(f.session.vote(true)).rejects.toThrow('phase');
  expect(f.round.snapshot()).toEqual(journal);
  expect(f.published).toHaveLength(0);
  // The cancellation is specific to A; a fresh valid B must still work.
  await f.receive({ ...vote, vote_id: 'bb'.repeat(8) });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8) });
  const active = f.session.snapshot();
  await f.receive(events.c);
  expect(f.session.snapshot()).toEqual(active);
  expect(f.published).toHaveLength(0);
});

test.each(['reopen', 'roster', 'closing'] as const)(
  'creator %s resolves a vote after its deadline, within the pool deadline',
  async type => {
    const f = await fixture();
    await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
    await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
    await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
    f.tick(601);
    await expect(f.session.vote(true)).rejects.toThrow('expired');
    const body =
      type === 'reopen'
        ? { type, vote_id: 'aa'.repeat(8) }
        : type === 'roster'
          ? { type, seq: 2, seats: f.rawSeats }
          : { type, round_id: 'bb'.repeat(8), seats: f.rawSeats, deadline: 10901 };
    await f.receive(body);
    expect(f.session.snapshot().phase).toBe(type === 'reopen' ? 'open' : type === 'roster' ? 'voting' : 'closing');
    expect(f.round.snapshot().phase).toBe('joined');
    expect(f.round.snapshot().reserved).toHaveLength(1);
    expect(f.session.snapshot().signatures).toEqual({});
    expect(f.published).toHaveLength(type === 'closing' ? 1 : 0); // Only a blinded output request, never a spending signature.
  },
);

test.each(['reopen', 'roster', 'closing'] as const)('creator %s cannot extend the overall pool deadline', async type => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
  const before = f.session.snapshot();
  f.tick(2000);
  const body =
    type === 'reopen'
      ? { type, vote_id: 'aa'.repeat(8) }
      : type === 'roster'
        ? { type, seq: 2, seats: f.rawSeats }
        : { type, round_id: 'bb'.repeat(8), seats: f.rawSeats, deadline: 12300 };
  await expect(f.receive(body)).rejects.toThrow('expired');
  expect(f.session.snapshot()).toEqual(before);
  expect(f.published).toHaveLength(0);
});

test.each(['reopen', 'roster', 'closing'] as const)('creator %s cannot extend the upstream resolution grace', async type => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
  const before = f.session.snapshot();
  f.tick(780);
  const body =
    type === 'reopen'
      ? { type, vote_id: 'aa'.repeat(8) }
      : type === 'roster'
        ? { type, seq: 2, seats: f.rawSeats }
        : { type, round_id: 'bb'.repeat(8), seats: f.rawSeats, deadline: 11080 };
  await expect(f.receive(body)).rejects.toThrow('expired');
  expect(f.session.snapshot()).toEqual(before);
  expect(f.published).toHaveLength(0);
});

test.each([false, true])('failed cancellation persistence preserves pending/active vote (roster received: %s)', async withRoster => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  if (withRoster) await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
  const before = f.session.snapshot();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('private native detail'));
  await expect(f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) })).rejects.toThrow('Session persistence failed');
  expect(f.session.snapshot()).toEqual(before);
  if (!withRoster) await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'aa'.repeat(8) });
  expect(f.published).toHaveLength(0);
});

test('pool-member cancellation cannot retire a creator vote or clear its pending request', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) }, false, pool);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'aa'.repeat(8) });
  expect(f.published).toHaveLength(0);
});

test('cancellation history is bounded without evicting a previously cancelled vote', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  for (let i = 0; i < 256; i++) await f.receive({ type: 'reopen', vote_id: i.toString(16).padStart(16, '0') });
  const before = f.session.snapshot();
  await expect(f.receive({ type: 'reopen', vote_id: 'ff'.repeat(8) })).rejects.toThrow('Session vote history limit');
  await f.receive({ type: 'vote_open', vote_id: '0'.repeat(16), by: f.rawSeats[1].token_hash });
  expect(f.session.snapshot()).toEqual(before);
  expect(f.published).toHaveLength(0);
});

test('a cancellation for another vote preserves the current vote and its deadline', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8), deadline: 10600 });
  expect(f.env.saveEncrypted).toHaveBeenLastCalledWith(expect.objectContaining({ retiredVoteIds: ['aa'.repeat(8)] }));
  expect(f.published).toHaveLength(0);
});

test.each(['roster', 'closing'] as const)('late creator %s still rejects invalid ownership and unspent observations', async type => {
  for (const failure of ['proof', 'chain']) {
    const f = await fixture();
    await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
    await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
    await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
    f.tick(601);
    const before = f.session.snapshot(),
      seats = JSON.parse(JSON.stringify(f.rawSeats));
    if (failure === 'proof') seats[1].proofs[0] = '00';
    else f.env.observe = async () => new Map();
    const body = type === 'roster' ? { type, seq: 2, seats } : { type, round_id: 'bb'.repeat(8), seats, deadline: 10901 };
    await expect(f.receive(body)).rejects.toThrow(
      failure === 'proof' ? 'Invalid ownership proof' : 'Missing, stale or mismatched chain observation',
    );
    expect(f.session.snapshot()).toEqual({ ...before, lastRosterFailure: failure === 'proof' ? 'KJ-PROOF' : 'KJ-CHAIN-OBSERVATION' });
    expect(f.published).toHaveLength(0);
  }
});

test('late closing retains its own strict deadline even when the vote deadline has passed', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
  f.tick(601);
  const before = f.session.snapshot();
  for (const deadline of [10601, 10902]) {
    await expect(f.receive({ type: 'closing', round_id: 'bb'.repeat(8), seats: f.rawSeats, deadline })).rejects.toThrow(
      'Invalid closing deadline',
    );
  }
  expect(f.session.snapshot()).toEqual(before);
  expect(f.published).toHaveLength(0);
});

const overlappingOrders = ['abc', 'acb', 'bac', 'bca', 'cab', 'cba'];
test.each(
  (['p2wpkh', 'p2tr'] as const).flatMap(type => [1, 5].flatMap(outputs => overlappingOrders.map(order => ({ type, outputs, order })))),
)('overlapping votes preserve the surviving cycle for $type/$outputs/$order', async ({ type, outputs, order }) => {
  const f = await fixture(type, outputs);
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  const journal = f.round.snapshot();
  const events: Record<string, Record<string, unknown>> = {
    a: { type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash },
    b: { type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash },
    c: { type: 'reopen', vote_id: 'aa'.repeat(8) },
  };
  for (const step of order) await f.receive(events[step]);
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8), deadline: 10600 });
  expect(f.session.snapshot().seats).toHaveLength(2);
  expect(f.round.snapshot()).toEqual(journal);
  expect(f.session.snapshot().signatures).toEqual({});
  expect(f.published).toHaveLength(0);
});

function permutations(items: string[]): string[][] {
  return items.length === 0 ? [[]] : items.flatMap((item, i) => permutations(items.filter((_, j) => i !== j)).map(rest => [item, ...rest]));
}
test.each(
  (['p2wpkh', 'p2tr'] as const).flatMap(type =>
    [1, 5].flatMap(outputs => permutations(['r', 'a', 'b', 'c']).map(order => ({ type, outputs, order: order.join('') }))),
  ),
)('initial replay cycles converge with delayed roster for $type/$outputs/$order', async ({ type, outputs, order }) => {
  const f = await fixture(type, outputs);
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const journal = f.round.snapshot();
  const events: Record<string, Record<string, unknown>> = {
    r: { type: 'roster', seq: 1, seats: f.rawSeats },
    a: { type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash },
    b: { type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash },
    c: { type: 'reopen', vote_id: 'aa'.repeat(8) },
  };
  let rosterSeen = false;
  for (const step of order) {
    await f.receive(events[step]);
    if (step === 'r') rosterSeen = true;
    if (!rosterSeen) {
      expect(f.session.snapshot()).toMatchObject({ phase: 'open', seats: [], sequence: 0 });
      await expect(f.session.vote(true)).rejects.toThrow('phase');
    }
    expect(f.round.snapshot()).toEqual(journal);
    expect(f.published).toHaveLength(0);
  }
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8), deadline: 10600, sequence: 1 });
  expect(f.session.snapshot().seats).toHaveLength(2);
  expect(f.session.snapshot().signatures).toEqual({});
});
test.each(permutations(['a', 'b', 'd', 'x', 'y']).map(order => [order.join('')]))(
  'three replayed cycles converge after both cancellations: %s',
  async order => {
    const f = await fixture('p2wpkh', 5);
    await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
    await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
    const journal = f.round.snapshot();
    const events: Record<string, Record<string, unknown>> = {
      a: { type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash },
      b: { type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash },
      d: { type: 'vote_open', vote_id: 'dd'.repeat(8), by: f.rawSeats[1].token_hash },
      x: { type: 'reopen', vote_id: 'aa'.repeat(8) },
      y: { type: 'reopen', vote_id: 'bb'.repeat(8) },
    };
    for (const step of order) await f.receive(events[step]);
    expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'dd'.repeat(8), deadline: 10600 });
    expect(f.round.snapshot()).toEqual(journal);
    expect(f.published).toHaveLength(0);
  },
);

async function activeVoteFixture() {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
  return f;
}

const rosterVoteCases = (['p2wpkh', 'p2tr'] as const).flatMap(type =>
  [1, 5].flatMap(outputs =>
    [
      ...['rv', 'vr'].map(order => ({ mode: 'open', order })),
      ...['rvc', 'rcv', 'vrc', 'vcr', 'crv', 'cvr'].map(order => ({ mode: 'voting', order })),
      ...['rv', 'vr'].map(order => ({ mode: 'quorum', order })),
    ].map(scenario => ({ type, outputs, ...scenario })),
  ),
);

test.each(rosterVoteCases)(
  'a verified roster update and its vote may arrive in either order: $type/$outputs/$mode/$order',
  async ({ type, outputs, mode, order }) => {
    const f = await fixture(type, outputs);
    await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
    const initial = mode === 'quorum' ? [f.rawSeats[0]] : f.rawSeats;
    await f.receive({ type: 'roster', seq: 1, seats: initial });
    if (mode === 'voting') await f.receive({ type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash });
    const key = secret(3),
      joinPub = pub(secret(11)),
      coin = { ...f.rawSeats[1].coin, txid: '3'.repeat(64), pubkey: Buffer.from(ecc.pointFromScalar(key, true)!).toString('hex') };
    const newcomer = {
      coin,
      join_pub: joinPub,
      token_hash: 'ef'.repeat(32),
      proofs: [Buffer.from(ecc.signDER(ownershipMessage(f.terms.id, joinPub, coin), key)).toString('hex')],
      change_script: type === 'p2wpkh' ? '0014' + 'c'.repeat(40) : '5120' + 'c'.repeat(64),
      change_value: f.rawSeats[1].change_value,
    };
    const seats = mode === 'quorum' ? f.rawSeats : [...f.rawSeats, newcomer];
    const events: Record<string, Record<string, unknown>> = {
      r: { type: 'roster', seq: 2, seats },
      v: { type: 'vote_open', vote_id: 'bb'.repeat(8), by: mode === 'quorum' ? f.rawSeats[1].token_hash : newcomer.token_hash },
      c: { type: 'reopen', vote_id: 'aa'.repeat(8) },
    };
    const journal = f.round.snapshot();
    for (const step of order) await f.receive(events[step]);
    expect(f.session.snapshot()).toMatchObject({ phase: 'voting', sequence: 2, voteId: 'bb'.repeat(8), deadline: 10600 });
    expect(f.session.snapshot().seats).toHaveLength(seats.length);
    expect(f.round.snapshot()).toEqual(journal);
    expect(f.published).toHaveLength(0);
  },
);

async function waitingRosterFixture() {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: [f.rawSeats[0]] });
  await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
  return f;
}

test('a vote waiting for an updated roster cannot publish, spend, change reservations or accept a stale roster', async () => {
  const f = await waitingRosterFixture();
  const before = f.session.snapshot(),
    journal = f.round.snapshot();
  await expect(f.session.vote(true)).rejects.toThrow('phase');
  const signer = jest.fn();
  await expect(f.session.signApproved('00'.repeat(32), signer)).rejects.toThrow();
  expect(signer).not.toHaveBeenCalled();
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  expect(f.session.snapshot()).toEqual(before);
  expect(f.round.snapshot()).toEqual(journal);
  expect(f.published).toHaveLength(0);
});

test.each(['proof', 'chain', 'own-seat', 'persist'] as const)(
  'an updated roster cannot activate a pending vote after a failing %s check',
  async fault => {
    const f = await waitingRosterFixture();
    const before = f.session.snapshot(),
      observe = f.env.observe,
      seats = JSON.parse(JSON.stringify(f.rawSeats));
    if (fault === 'proof') seats[1].proofs[0] = '00';
    if (fault === 'chain') f.env.observe = async () => new Map();
    if (fault === 'own-seat') seats[0].token_hash = 'ee'.repeat(32);
    if (fault === 'persist') (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('synthetic storage failure'));
    await expect(f.receive({ type: 'roster', seq: 2, seats })).rejects.toThrow();
    expect(f.session.snapshot()).toEqual(
      fault === 'persist'
        ? before
        : { ...before, lastRosterFailure: { proof: 'KJ-PROOF', chain: 'KJ-CHAIN-OBSERVATION', 'own-seat': 'KJ-WALLET-INPUTS' }[fault] },
    );
    await expect(f.session.vote(true)).rejects.toThrow('phase');
    expect(f.published).toHaveLength(0);
    expect(f.round.snapshot().reserved).toHaveLength(1);
    f.env.observe = observe;
    // A new authenticated envelope with a valid roster; no automatic action retry.
    await f.receive({ type: 'roster', seq: 2, seats: f.rawSeats });
    expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8), sequence: 2 });
    expect(f.published).toHaveLength(0);
  },
);

test.each(['expired', 'cancelled', 'unknown-caller'] as const)(
  'a later roster does not activate a pending vote that is %s',
  async fault => {
    const f = await waitingRosterFixture();
    if (fault === 'expired') f.tick(601);
    if (fault === 'cancelled') await f.receive({ type: 'reopen', vote_id: 'bb'.repeat(8) });
    const seats = fault === 'unknown-caller' ? [f.rawSeats[0]] : f.rawSeats;
    await f.receive({ type: 'roster', seq: 2, seats });
    expect(f.session.snapshot().phase).toBe('open');
    expect(f.session.snapshot().voteId).toBeUndefined();
    await expect(f.session.vote(true)).rejects.toThrow('phase');
    expect(f.published).toHaveLength(0);
    expect(f.round.snapshot().reserved).toHaveLength(1);
  },
);

test('pending roster votes preserve the first timestamp and enforce identity and resource bounds', async () => {
  const f = await waitingRosterFixture();
  f.tick(60);
  await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
  await expect(f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[0].token_hash })).rejects.toThrow(
    'Conflicting pending vote identity',
  );
  for (let i = 1; i < 32; i++)
    await f.receive({ type: 'vote_open', vote_id: i.toString(16).padStart(16, '0'), by: f.rawSeats[1].token_hash });
  await expect(f.receive({ type: 'vote_open', vote_id: 'ee'.repeat(8), by: f.rawSeats[1].token_hash })).rejects.toThrow(
    'Pending vote limit',
  );
  await f.receive({ type: 'roster', seq: 2, seats: f.rawSeats });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8), deadline: 10600 });
  expect(f.published).toHaveLength(0);
});

test('future vote buffering does not change the active vote, deadline, persisted state or journal', async () => {
  const f = await activeVoteFixture();
  const before = f.session.snapshot(),
    journal = f.round.snapshot();
  const writes = (f.env.saveEncrypted as jest.Mock).mock.calls.length;
  f.tick(60);
  const next = { type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash };
  await f.receive(next);
  await f.receive(next); // Re-encrypted duplicate cannot extend the first deadline.
  expect(f.session.snapshot()).toEqual(before);
  expect(f.round.snapshot()).toEqual(journal);
  expect(f.env.saveEncrypted).toHaveBeenCalledTimes(writes);
  expect(f.published).toHaveLength(0);
  f.tick(40);
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8), deadline: 10660 });
  f.tick(560);
  await expect(f.session.vote(true)).rejects.toThrow('expired');
});

test('failed atomic cancellation/promotion keeps the original vote and retains the next request', async () => {
  const f = await activeVoteFixture();
  await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
  const before = f.session.snapshot();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('private synthetic detail'));
  await expect(f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) })).rejects.toThrow('Session persistence failed');
  expect(f.session.snapshot()).toEqual(before);
  // New authenticated envelope after the injected failure; no automatic wallet-action retry.
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8) });
  expect(f.published).toHaveLength(0);
  expect(f.round.snapshot().phase).toBe('joined');
});

test.each(['expired', 'removed-caller', 'cancelled', 'wrong-authority', 'unknown-caller'] as const)(
  'does not promote a following vote that is %s',
  async problem => {
    const f = await activeVoteFixture();
    await f.receive(
      { type: 'vote_open', vote_id: 'bb'.repeat(8), by: problem === 'unknown-caller' ? 'ff'.repeat(32) : f.rawSeats[1].token_hash },
      false,
      problem === 'wrong-authority' ? pool : creator,
    );
    if (problem === 'expired') f.tick(601);
    if (problem === 'removed-caller') await f.receive({ type: 'roster', seq: 2, seats: [f.rawSeats[0]] });
    if (problem === 'cancelled') await f.receive({ type: 'reopen', vote_id: 'bb'.repeat(8) });
    await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
    expect(f.session.snapshot()).toMatchObject({ phase: 'open', deadline: 12000 });
    expect(f.session.snapshot().voteId).toBeUndefined();
    expect(f.published).toHaveLength(0);
    expect(f.round.snapshot().reserved).toHaveLength(1);
  },
);

test('conflicting identity cannot replace an already buffered vote', async () => {
  const f = await activeVoteFixture();
  await f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[1].token_hash });
  await expect(f.receive({ type: 'vote_open', vote_id: 'bb'.repeat(8), by: f.rawSeats[0].token_hash })).rejects.toThrow(
    'Conflicting pending vote identity',
  );
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: 'bb'.repeat(8) });
  expect(f.published).toHaveLength(0);
});

test('pending vote resource limit keeps the existing request and cannot bypass cancellation', async () => {
  const f = await activeVoteFixture();
  for (let i = 1; i <= 32; i++)
    await f.receive({ type: 'vote_open', vote_id: i.toString(16).padStart(16, '0'), by: f.rawSeats[1].token_hash });
  const before = f.session.snapshot();
  await expect(f.receive({ type: 'vote_open', vote_id: 'ee'.repeat(8), by: f.rawSeats[1].token_hash })).rejects.toThrow(
    'Pending vote limit',
  );
  expect(f.session.snapshot()).toEqual(before);
  await f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot()).toMatchObject({ phase: 'voting', voteId: '0000000000000001' });
  expect(f.published).toHaveLength(0);
});

test.each(['p2wpkh', 'p2tr'] as const)(
  'encrypted %s participant round verifies blind output, explicit approval and all signatures',
  async type => {
    const f = await fixture(type);
    await f.advance();
    expect(f.session.snapshot().phase).toBe('review');
    expect(f.session.snapshot().token).toBeUndefined();
    expect(f.published[1].isolated).toBe(true);
    expect(f.published[1].event.pubkey).not.toBe(pub(pool));
    expect(f.published[1].event.pubkey).not.toBe(pub(join));
    const output = JSON.parse(decrypt(f.published[1].event.content, conversationKey(creator, f.published[1].event.pubkey)));
    expect(output.token_hash).toBeUndefined();
    let peerSignature = '';
    await f.session.signApproved(f.session.reviewed().commitment!, async p => {
      peerSignature = f.signature(p, 1);
      return new Map([[outpoint(p.coins[0]), f.signature(p, 0)]]);
    });
    expect(() => f.session.completedTransaction()).toThrow('count');
    await f.receive({ type: 'sig', outpoint: outpoint(f.rawSeats[1].coin), sig: peerSignature }, false, pool);
    const tx = Transaction.fromHex(f.session.completedTransaction());
    if (process.env.KILOJOIN_INTEROP_OUTPUT) {
      // Explicit standalone interoperability harness; no files written in normal unit runs.
      require('fs').appendFileSync(
        process.env.KILOJOIN_INTEROP_OUTPUT,
        [type, tx.getId(), tx.toHex(), ...tx.ins.map(i => Buffer.from(i.witness[0]).toString('hex'))].join('\t') + '\n',
      );
    }
    expect(tx.getId()).toBe(f.session.reviewed().reviewedId);
    expect(tx.ins.every(i => i.witness.length > 0)).toBe(true);
    await f.session.cancel();
    expect(f.round.snapshot().phase).toBe('uncertain');
    expect(f.round.snapshot().reserved).toHaveLength(1);
  },
);
test('session persistence failure before signing never invokes spending-key code', async () => {
  const f = await fixture();
  await f.advance();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('keychain unavailable'));
  const signer = jest.fn();
  await expect(f.session.signApproved(f.session.reviewed().commitment!, signer)).rejects.toThrow('Session persistence failed');
  expect(signer).not.toHaveBeenCalled();
  expect(f.round.snapshot().phase).toBe('signed');
  await f.session.cancel();
  expect(f.round.snapshot().reserved).toHaveLength(1);
});
test('wrong displayed commitment and peer tx claims cannot authorize or confirm spending', async () => {
  const f = await fixture();
  await f.advance();
  const signer = jest.fn();
  await expect(f.session.signApproved('00'.repeat(32), signer)).rejects.toThrow('review changed');
  expect(signer).not.toHaveBeenCalled();
  await f.receive({ type: 'tx', txid: f.session.reviewed().reviewedId }, false, pool);
  expect(f.round.snapshot().phase).toBe('review');
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test('welcome arriving before publication acknowledgment waits for the join action', async () => {
  const f = await fixture();
  let welcome: Promise<void> | undefined;
  f.env.publish = async () => {
    welcome = f.receive({ type: 'welcome', pool_secret: pool.toString('hex'), token: 'ab'.repeat(16), seq: 1 }, true);
    await Promise.resolve();
    expect(f.session.snapshot().phase).toBe('joining');
  };
  const own = f.rawSeats[0];
  const proof = Buffer.from(ecc.signDER(changeMessage(f.terms.id, [own.coin], own.change_script, own.change_value), secret(1))).toString(
    'hex',
  );
  await f.session.sendJoin(proof);
  await welcome;
  expect(f.session.snapshot().phase).toBe('open');
});

test.each([
  ['p2wpkh', 2],
  ['p2wpkh', 5],
  ['p2tr', 2],
  ['p2tr', 5],
] as const)('v4 %s with %s outputs verifies every output and uses distinct publication identities', async (type, count) => {
  const f = await fixture(type, count);
  await f.advance();
  expect(f.session.snapshot().phase).toBe('review');
  expect(f.session.snapshot().outputStates).toBeUndefined();
  const isolated = f.published.filter(p => p.isolated);
  expect(isolated).toHaveLength(count);
  expect(new Set(isolated.map(p => p.event.pubkey)).size).toBe(count);
  for (const { event } of isolated) {
    expect(event.pubkey).not.toBe(pub(join));
    const body = JSON.parse(decrypt(event.content, conversationKey(creator, event.pubkey)));
    expect(body.token_hash).toBeUndefined();
    expect(body.type).toBe('output');
  }
  let peerSignature = '';
  await f.session.signApproved(f.session.reviewed().commitment!, async p => {
    expect(p.people).toBe(2);
    expect(p.outputsPerPerson).toBe(count);
    peerSignature = f.signature(p, 1);
    return new Map([[outpoint(p.coins[0]), f.signature(p, 0)]]);
  });
  await f.receive({ type: 'sig', outpoint: outpoint(f.rawSeats[1].coin), sig: peerSignature }, false, pool);
  const result = Transaction.fromHex(f.session.completedTransaction());
  expect(result.outs.filter(o => o.value === 10000n)).toHaveLength(count * 2);
  expect(result.ins.every(i => i.witness[0][i.witness[0].length - 1] === 0x21)).toBe(true);
  await f.session.cancel();
  expect(f.round.snapshot().phase).toBe('uncertain');
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test.each(['missing', 'invalid', 'swapped'])('v4 rejects %s blind signatures before any output publication', async fault => {
  const f = await fixture('p2wpkh', 2);
  await expect(
    f.advance(body => {
      const sigs = [...(body.sigs as string[])];
      if (fault === 'missing') sigs.pop();
      if (fault === 'invalid') sigs[0] = '00'.repeat(256);
      if (fault === 'swapped') sigs.reverse();
      return { ...body, sigs };
    }),
  ).rejects.toThrow();
  expect(f.published.filter(p => p.isolated)).toHaveLength(0);
  expect(f.session.snapshot().phase).toBe('closing');
  expect(f.round.snapshot().phase).toBe('joined');
});

test('v4 interrupted output publication preserves the acknowledged output and does not retry automatically', async () => {
  const f = await fixture('p2wpkh', 5);
  const publish = f.env.publish;
  let outputs = 0;
  f.env.publish = async (event, isolated) => {
    if (isolated && ++outputs === 2) throw new Error('fixture disconnect');
    await publish(event, isolated);
  };
  await expect(f.advance()).rejects.toThrow('fixture disconnect');
  expect(f.published.filter(p => p.isolated)).toHaveLength(1);
  expect(f.round.snapshot().reserved).toHaveLength(1);
  await Promise.resolve();
  expect(outputs).toBe(2);
  await f.session.submitOutput();
  const messages = f.published
    .filter(p => p.isolated)
    .map(({ event }) => JSON.parse(decrypt(event.content, conversationKey(creator, event.pubkey))));
  expect(messages).toHaveLength(5);
  expect(new Set(messages.map(m => m.script)).size).toBe(5);
  await f.session.cancel();
  expect(f.round.snapshot().phase).toBe('aborted');
  expect(f.round.snapshot().reserved).toHaveLength(0);
});

test('v4 review summary matches every promised output and unsigned restart releases only unsigned reservations', async () => {
  const f = await fixture('p2tr', 5);
  expect(f.session.reviewSummary()).toBeUndefined();
  await f.advance();
  expect(f.session.reviewSummary()).toEqual({ count: 5, amount: 10000, total: 50000, change: f.rawSeats[0].change_value });
  const recovered = await Round.restore(f.round.snapshot(), 'wallet', 10050, { save: async () => {} });
  expect(recovered.snapshot().phase).toBe('aborted');
  expect(recovered.snapshot().reserved).toHaveLength(0);
});

test.each([1, 5])('welcome sequence excludes pre-join roster history for %i-output pools without accepting rewinds', async count => {
  const f = await fixture('p2wpkh', count);
  await f.receive({ type: 'welcome', pool_secret: pool.toString('hex'), token: 'ab'.repeat(16), seq: 2 }, true);
  const prior = f.session.snapshot();
  await f.receive({ type: 'roster', seq: 1, seats: [f.rawSeats[1]] });
  expect(f.session.snapshot()).toEqual(prior);
  await f.receive({ type: 'roster', seq: 2, seats: f.rawSeats });
  const accepted = f.session.snapshot();
  expect(accepted.seats).toHaveLength(2);
  await f.receive({ type: 'roster', seq: 1, seats: [] });
  expect(f.session.snapshot()).toEqual(accepted);
  await expect(f.receive({ type: 'roster', seq: 2, seats: [f.rawSeats[1]] })).resolves.toBeUndefined();
  expect(f.session.snapshot().seats).toHaveLength(2);
  await expect(f.receive({ type: 'roster', seq: 3, seats: [f.rawSeats[1]] })).rejects.toThrow();
  expect(f.session.snapshot()).toEqual({ ...accepted, lastRosterFailure: 'KJ-OWN-SEAT' });
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test.each([1, 5])('relay serializes immediate roster/vote/closing while chain checks wait for %i outputs', async outputs => {
  const f = await fixture('p2wpkh', outputs);
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const observe = f.env.observe;
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  f.env.observe = async coins => {
    await gate;
    return observe(coins);
  };
  const socket = {
    onopen: undefined as undefined | (() => void),
    onmessage: undefined as undefined | ((event: { data: string }) => void),
    send: jest.fn(),
    close: jest.fn(),
  };
  let processed = 0;
  let finish!: () => void;
  let fail!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const relay = new KilojoinRelay(
    async event => {
      await f.session.receive(event);
      if (++processed === 3) finish();
    },
    fail,
    () => socket as unknown as WebSocket,
  );
  const connected = relay.connect();
  socket.onopen!();
  await connected;
  relay.subscribe([pub(creator)], [pub(pool)], 10000);
  for (const body of [
    { type: 'roster', seq: 1, seats: f.rawSeats },
    { type: 'vote_open', vote_id: 'aa'.repeat(8), by: f.rawSeats[1].token_hash },
    { type: 'closing', round_id: 'bb'.repeat(8), seats: f.rawSeats, deadline: 10300 },
  ]) {
    const event = signEvent(
      {
        kind: 2023,
        created_at: 10000,
        tags: [['p', pub(pool)]],
        content: encrypt(JSON.stringify(body), conversationKey(creator, pub(pool)), randomBytes(32)),
      },
      creator,
      randomBytes(32),
    );
    socket.onmessage!({ data: JSON.stringify(['EVENT', 'kilojoin-participant-1', event]) });
  }
  await Promise.resolve();
  expect(f.session.snapshot().phase).toBe('open');
  release();
  try {
    await done;
    expect(f.session.snapshot().phase).toBe('closing');
    expect(f.session.snapshot().seats).toHaveLength(2);
    expect(f.published).toHaveLength(1);
  } finally {
    relay.close();
  }
});

test('stop can finish after encrypted cancellation persistence fails following durable unsigned cancellation', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('synthetic encrypted write failure'));
  await expect(f.session.cancel()).rejects.toThrow('Session persistence failed');
  expect(f.round.snapshot().phase).toBe('aborted');
  expect(f.round.snapshot().reserved).toEqual([]);
  await expect(f.session.cancel()).resolves.toBeUndefined();
  expect(f.session.snapshot().phase).toBe('aborted');
  expect(f.published).toHaveLength(0);
});

test.each([false, true])('durable cancellation closes queued vote replay even when terminal storage fails (roster %s)', async roster => {
  const f = await pendingVotesFixture();
  if (roster) await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('synthetic encrypted write failure'));
  await expect(f.session.cancel()).rejects.toThrow('Session persistence failed');
  const before = f.session.snapshot();
  await expect(f.receive({ type: 'reopen', vote_id: 'aa'.repeat(8) })).rejects.toThrow('Session closed');
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).rejects.toThrow('Session closed');
  expect(f.session.snapshot()).toEqual(before);
  expect(f.round.snapshot().phase).toBe('aborted');
  expect(f.published).toHaveLength(0);
});

test('repeated Stop is idempotent after a durable unsigned cancellation', async () => {
  const f = await fixture();
  await f.session.cancel();
  await expect(f.session.cancel()).resolves.toBeUndefined();
  expect(f.round.snapshot().phase).toBe('aborted');
  expect(f.round.snapshot().reserved).toEqual([]);
  expect(f.session.snapshot().phase).toBe('aborted');
  expect(f.published).toHaveLength(0);
});

test('concurrent Stop requests settle without reopening or cancelling the journal twice', async () => {
  const f = await fixture();
  await expect(Promise.all([f.session.cancel(), f.session.cancel(), f.session.cancel()])).resolves.toEqual([
    undefined,
    undefined,
    undefined,
  ]);
  expect(f.round.snapshot().reserved).toEqual([]);
  expect(f.session.snapshot().phase).toBe('aborted');
  expect(f.published).toHaveLength(0);
});

test('failed encrypted cancellation after signing never releases reservations on Stop retry', async () => {
  const f = await fixture();
  await f.advance();
  await f.session.signApproved(f.session.reviewed().commitment!, async p => new Map([[outpoint(p.coins[0]), f.signature(p, 0)]]));
  const published = f.published.length;
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('synthetic encrypted write failure'));
  await expect(f.session.cancel()).rejects.toThrow('Session persistence failed');
  expect(f.round.snapshot().phase).toBe('uncertain');
  expect(f.round.snapshot().reserved).toHaveLength(1);
  await expect(f.session.cancel()).resolves.toBeUndefined();
  expect(f.round.snapshot().phase).toBe('uncertain');
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.session.snapshot().phase).toBe('aborted');
  expect(f.published).toHaveLength(published);
});

test('stop waits for an in-flight roster check before cancelling an unsigned round', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const observe = f.env.observe;
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  f.env.observe = async coins => {
    entered();
    await gate;
    return observe(coins);
  };
  const roster = f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await started;
  const stopped = f.session.cancel().then(
    () => 'stopped',
    error => error.message,
  );
  expect(f.round.snapshot().reserved).toHaveLength(1);
  release();
  await roster;
  expect(await stopped).toBe('stopped');
  expect(f.session.snapshot().phase).toBe('aborted');
  expect(f.round.snapshot().reserved).toHaveLength(0);
});

test.each([false, true])('stop during signing retains coins even if publication fails: %s', async publicationFails => {
  const f = await fixture();
  await f.advance();
  let entered!: () => void;
  let release!: () => void;
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  if (publicationFails)
    f.env.publish = async () => {
      throw new Error('relay already closed');
    };
  const signing = f.session
    .signApproved(f.session.reviewed().commitment!, async p => {
      entered();
      await gate;
      return new Map([[outpoint(p.coins[0]), f.signature(p, 0)]]);
    })
    .then(
      () => 'signed',
      error => error.message,
    );
  await started;
  const stopped = f.session.cancel();
  expect(f.round.snapshot().phase).toBe('signed');
  expect(f.round.snapshot().reserved).toHaveLength(1);
  release();
  expect(await signing).toBe(publicationFails ? 'relay already closed' : 'signed');
  await stopped;
  expect(f.round.snapshot().phase).toBe('uncertain');
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test('stop also waits for a participant message already waiting on signing', async () => {
  const f = await fixture();
  await f.advance();
  let entered!: () => void;
  let release!: () => void;
  let peerSignature = '';
  const started = new Promise<void>(resolve => {
    entered = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const signing = f.session.signApproved(f.session.reviewed().commitment!, async p => {
    peerSignature = f.signature(p, 1);
    entered();
    await gate;
    return new Map([[outpoint(p.coins[0]), f.signature(p, 0)]]);
  });
  await started;
  // The relay's current handler may already be waiting for a UI signing action.
  const participant = f.receive({ type: 'sig', outpoint: outpoint(f.rawSeats[1].coin), sig: peerSignature }, false, pool);
  const stopped = f.session.cancel().then(
    () => 'stopped',
    error => error.message,
  );
  release();
  await signing;
  await participant;
  expect(await stopped).toBe('stopped');
  expect(f.round.snapshot().phase).toBe('uncertain');
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test.each(['proof', 'change', 'chain', 'own-seat'])('identifies a rejected first roster (%s) without advancing or signing', async fault => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const seats = JSON.parse(JSON.stringify(f.rawSeats));
  if (fault === 'proof') seats[1].proofs[0] = seats[0].proofs[0];
  if (fault === 'change') seats[1].change_value++;
  if (fault === 'own-seat') seats[0].change_script = '0014' + '77'.repeat(20);
  if (fault === 'chain') f.env.observe = async () => new Map();
  const before = f.session.snapshot();
  const error = await f.receive({ type: 'roster', seq: 1, seats }).then(
    () => undefined,
    failure => failure,
  );
  expect(error).toBeInstanceOf(Error);
  const code = { proof: 'KJ-PROOF', change: 'KJ-CHANGE', chain: 'KJ-CHAIN-OBSERVATION', 'own-seat': 'KJ-OWN-SEAT' }[fault];
  expect(relayFailureMessage(participantFailure(error))).toContain(`Diagnostic: ${code}.`);
  expect(f.session.snapshot()).toEqual({ ...before, lastRosterFailure: code });
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
});

test('offline review: retains safe pool rejection code while joining', async () => {
  const f = await fixture();
  await f.receive({ type: 'reject', reason: 'that coin is not unspent on the chain' }, true);
  expect(f.session.snapshot()).toMatchObject({ phase: 'aborted', terminalCause: 'creator-rejected', terminalReason: 'coin-not-unspent' });
  expect(f.env.saveEncrypted).toHaveBeenLastCalledWith(expect.objectContaining({ terminalReason: 'coin-not-unspent' }));
  expect(coinjoinProgress(f.session.snapshot(), f.round.snapshot()).detail).toContain('not unspent');
  expect(f.round.snapshot().reserved).toHaveLength(0);
  expect(f.published).toHaveLength(0);
});
test.each(['private address secret', '__proto__', '', null, 42])('offline review: unknown reject reasons never leak: %s', async reason => {
  const f = await fixture();
  await f.receive({ type: 'reject', reason }, true);
  expect(f.session.snapshot()).toHaveProperty('terminalReason', 'unknown');
  expect(JSON.stringify(f.session.snapshot())).not.toContain('private address secret');
  expect(JSON.stringify((f.env.saveEncrypted as jest.Mock).mock.calls)).not.toContain('private address secret');
});
test('offline review: failed first roster persists a fixed diagnostic, retains locks, then clears on successful newer roster', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const healthyObserve = f.env.observe;
  f.env.observe = async () => new Map();
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).rejects.toThrow('chain observation');
  expect(f.session.snapshot()).toHaveProperty('lastRosterFailure', expect.stringMatching(/^KJ-CHAIN/));
  expect(f.session.snapshot()).toMatchObject({ phase: 'open', seats: [], sequence: 0 });
  expect(coinjoinProgress(f.session.snapshot(), f.round.snapshot()).title).toContain('Validation failed');
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
  f.env.observe = healthyObserve;
  await f.receive({ type: 'roster', seq: 2, seats: f.rawSeats });
  expect(f.session.snapshot()).not.toHaveProperty('lastRosterFailure');
  expect(f.session.snapshot().seats).toHaveLength(2);
  expect(coinjoinProgress(f.session.snapshot(), f.round.snapshot()).title).toBe('In pool');
  expect(f.published).toHaveLength(0);
});
test('offline review: failed diagnostic persistence cannot replace valid session state or release reservations', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const before = f.session.snapshot();
  f.env.observe = async () => new Map();
  (f.env.saveEncrypted as jest.Mock).mockRejectedValue(new Error('private storage detail'));
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).rejects.toThrow('Session persistence failed');
  expect(f.session.snapshot()).toEqual(before);
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
});

test('offline review: direct rejection after welcome remains ignored under existing routing guards', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const before = f.session.snapshot();
  await f.receive({ type: 'reject', reason: 'that coin is not unspent on the chain' }, true);
  expect(f.session.snapshot()).toEqual(before);
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
});

test.each([
  ["the coin's signature is wrong", 'invalid-proof'],
  ["the change does not match the pool's fee", 'invalid-change'],
])('offline review: maps fixed upstream rejection %s', async (reason, code) => {
  const f = await fixture();
  await f.receive({ type: 'reject', reason }, true);
  expect(f.session.snapshot().terminalReason).toBe(code);
  expect(f.round.snapshot().reserved).toHaveLength(0);
  expect(f.published).toHaveLength(0);
});

test('records the precise local chain failure seat and shortened outpoint without publishing', async () => {
  const { ChainValidationError } = await import('../../class/xbt/kilojoin/chain-error');
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  const coin = f.rawSeats[1].coin;
  f.env.observe = async () => {
    throw new ChainValidationError('KJ-CHAIN-CONFIRMATION', 'CoinJoin requires a verified confirmed unspent coin', 1);
  };
  await expect(f.receive({ type: 'roster', seq: 1, seats: f.rawSeats })).rejects.toThrow();
  expect(f.session.snapshot()).toMatchObject({
    lastRosterFailure: 'KJ-CHAIN-CONFIRMATION',
    lastRosterFailureInput: { seat: 2, coinPrefix: coin.txid.slice(0, 12) + ':' + coin.vout },
  });
  expect(coinjoinProgress(f.session.snapshot(), f.round.snapshot()).detail).toContain('Seat 2');
  expect(coinjoinProgress(f.session.snapshot(), f.round.snapshot()).detail).not.toContain(coin.txid);
  expect(f.session.snapshot().sequence).toBe(0);
  expect(f.session.snapshot().seats).toHaveLength(0);
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
});

test('closing response is saved only after publication, scoped to the vote, and never counts peer claims', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  const vote = 'aa'.repeat(8);
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: vote });
  const publish = f.env.publish;
  f.env.publish = async () => {
    throw new Error('relay unavailable');
  };
  await expect(f.session.vote(true)).rejects.toThrow('relay unavailable');
  expect(f.session.snapshot().closingResponse).toBeUndefined();
  f.env.publish = publish;
  await f.session.vote(true);
  expect(f.session.snapshot().closingResponse).toEqual({ voteId: vote, accept: true });
  expect(f.env.saveEncrypted).toHaveBeenLastCalledWith(
    expect.objectContaining({
      closingResponse: { voteId: vote, accept: true },
    }),
  );
  await f.receive({ type: 'vote', token_hash: f.rawSeats[1].token_hash, vote_id: vote, accept: true, mac: '00' }, false, pool);
  expect(f.session.snapshot().closingResponse).toEqual({ voteId: vote, accept: true });
  await f.session.vote(false);
  expect(f.session.snapshot().closingResponse).toEqual({ voteId: vote, accept: false });
  expect(f.session.snapshot().signatures).toEqual({});
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

test('a publication followed by persistence failure never displays a saved closing approval', async () => {
  const f = await fixture();
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'aa'.repeat(8) });
  (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
  await expect(f.session.vote(true)).rejects.toThrow('Session persistence failed');
  expect(f.published).toHaveLength(1);
  expect(f.session.snapshot().closingResponse).toBeUndefined();
  expect(f.round.snapshot().reserved).toHaveLength(1);
});

// Offline fault matrix for the phone's repeated output-registration stall.
async function outputTimeoutFixture(type: Coin['type'], count: number) {
  const f = await fixture(type, count);
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  const roundId = 'aa'.repeat(8);
  await f.receive({ type: 'closing', round_id: roundId, seats: f.rawSeats, deadline: 10300 });
  const request = JSON.parse(decrypt(f.published[0].event.content, conversationKey(pool, pub(pool))));
  const blinded: string[] = count === 1 ? [request.blinded] : request.blinded;
  const signatures = blinded.map(b =>
    modPow(BigInt('0x' + b), d, n)
      .toString(16)
      .padStart(512, '0'),
  );
  const reply = {
    type: 'blind_sig',
    round_id: roundId,
    token_hash: f.rawSeats[0].token_hash,
    ...(count === 1 ? { sig: signatures[0] } : { sigs: signatures }),
  };
  const assertUnsigned = () => {
    expect(f.session.snapshot().signatures).toEqual({});
    expect(f.round.snapshot().phase).toBe('joined');
    expect(f.round.snapshot().reserved).toHaveLength(1);
  };
  return { ...f, reply, assertUnsigned };
}
const outputTimeoutCases = (['p2wpkh', 'p2tr'] as const).flatMap(type => [1, 5].map(count => ({ type, count })));

test.each(outputTimeoutCases)(
  'output timeout matrix $type/$count: missing blind response cannot publish or sign',
  async ({ type, count }) => {
    const f = await outputTimeoutFixture(type, count);
    await expect(f.session.submitOutput()).rejects.toThrow('not ready');
    f.tick(301);
    await expect(f.session.submitOutput()).rejects.toThrow();
    await expect(f.session.retryBlind()).rejects.toThrow();
    const signer = jest.fn();
    await expect(f.session.signApproved('00'.repeat(32), signer)).rejects.toThrow();
    expect(signer).not.toHaveBeenCalled();
    expect(f.published.filter(p => p.isolated)).toHaveLength(0);
    f.assertUnsigned();
    await f.session.cancel();
    expect(f.round.snapshot().reserved).toHaveLength(0);
  },
);

test.each(outputTimeoutCases)(
  'output timeout matrix $type/$count: late blind reply does not restart the deadline',
  async ({ type, count }) => {
    const f = await outputTimeoutFixture(type, count);
    f.tick(300);
    await expect(f.receive(f.reply)).rejects.toThrow();
    expect(f.session.snapshot().deadline).toBe(10300);
    expect(f.session.snapshot().outputSignature).toBeUndefined();
    expect(f.published.filter(p => p.isolated)).toHaveLength(0);
    f.assertUnsigned();
  },
);

test.each(outputTimeoutCases)(
  'output timeout matrix $type/$count: foreground delay catches up and acknowledged outputs are not repeated',
  async ({ type, count }) => {
    const f = await outputTimeoutFixture(type, count);
    await f.receive(f.reply);
    f.tick(120); // app resumes after all random delays, before the absolute deadline
    await f.session.submitOutput();
    expect(f.published.filter(p => p.isolated)).toHaveLength(count);
    expect(f.session.snapshot().phase).toBe('closing');
    expect(f.session.snapshot().outputNotBefore).toBeUndefined();
    await f.session.submitOutput();
    expect(f.published.filter(p => p.isolated)).toHaveLength(count);
    f.assertUnsigned(); // relay publication alone is not transaction review
    f.tick(181);
    await expect(f.session.submitOutput()).rejects.toThrow();
    expect(f.session.snapshot().deadline).toBe(10300);
    await f.session.cancel();
    expect(f.round.snapshot().reserved).toHaveLength(0);
  },
);

test.each(outputTimeoutCases)(
  'output timeout matrix $type/$count: relay disconnect can retry before expiry but not after',
  async ({ type, count }) => {
    const f = await outputTimeoutFixture(type, count);
    await f.receive(f.reply);
    f.tick(45);
    const publish = f.env.publish;
    f.env.publish = async () => {
      throw new Error('offline output socket');
    };
    await expect(f.session.submitOutput()).rejects.toThrow('offline output socket');
    expect(f.published.filter(p => p.isolated)).toHaveLength(0);
    f.assertUnsigned();
    f.env.publish = publish;
    await f.session.submitOutput();
    expect(f.published.filter(p => p.isolated)).toHaveLength(count);
    f.tick(300);
    await expect(f.session.submitOutput()).rejects.toThrow();
    expect(f.published.filter(p => p.isolated)).toHaveLength(count);
    f.assertUnsigned();
  },
);

test.each(outputTimeoutCases)(
  'output timeout matrix $type/$count: late creator output list cannot bypass expiry',
  async ({ type, count }) => {
    const f = await outputTimeoutFixture(type, count);
    await f.receive(f.reply);
    f.tick(45);
    await f.session.submitOutput();
    const scripts = Array.from({ length: count * 2 }, (_, i) =>
      type === 'p2wpkh' ? '0014' + (5 + i).toString(16).repeat(40) : '5120' + (5 + i).toString(16).repeat(64),
    );
    f.tick(255);
    await expect(f.receive({ type: 'outputs', round_id: 'aa'.repeat(8), scripts })).rejects.toThrow();
    expect(f.session.snapshot().phase).toBe('closing');
    expect(f.session.reviewSummary()).toBeUndefined();
    f.assertUnsigned();
  },
);

test.each(outputTimeoutCases)(
  'output recovery gap $type/$count: failed initial blind request leaves output retry unavailable until blind is retried',
  async ({ type, count }) => {
    const f = await fixture(type, count);
    await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
    await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
    const publish = f.env.publish;
    f.env.publish = async () => {
      throw new Error('blind request disconnected');
    };
    await expect(f.receive({ type: 'closing', round_id: 'aa'.repeat(8), seats: f.rawSeats, deadline: 10300 })).rejects.toThrow(
      'blind request disconnected',
    );
    expect(f.session.snapshot()).toMatchObject({ phase: 'closing', deadline: 10300 });
    expect(f.session.snapshot().outputNotBefore).toBeUndefined();
    expect(f.session.snapshot().outputSignature).toBeUndefined();
    await expect(f.session.submitOutput()).rejects.toThrow('not ready');
    expect(f.round.snapshot().reserved).toHaveLength(1);
    expect(f.session.snapshot().signatures).toEqual({});
    f.env.publish = publish;
    // Recovery reuses the stored request under the original phase and deadline guards.
    await f.session.retryBlind();
    expect(f.published).toHaveLength(1);
    expect(f.published[0].isolated).toBe(false);
    const request = JSON.parse(decrypt(f.published[0].event.content, conversationKey(pool, pub(pool))));
    expect(request.type).toBe('blind');
    expect(request.round_id).toBe('aa'.repeat(8));
    expect(f.session.snapshot().deadline).toBe(10300);
    f.tick(301);
    await expect(f.session.retryBlind()).rejects.toThrow();
    await f.session.cancel();
    expect(f.round.snapshot().reserved).toHaveLength(0);
  },
);

test.each(
  (['p2wpkh', 'p2tr'] as const).flatMap(type => [1, 5].flatMap(count => [3, 6, 7].map(participants => ({ type, count, participants })))),
)(
  'participant size matrix $type/$count/$participants: valid output registration reaches review without automatic signing',
  async ({ type, count, participants }) => {
    const f = await fixture(type, count, participants);
    await f.advance();
    expect(f.session.snapshot().phase).toBe('review');
    expect(f.session.snapshot().seats).toHaveLength(participants);
    expect(f.session.reviewSummary()).toMatchObject({ count, amount: 10000, total: count * 10000 });
    expect(f.published.filter(p => p.isolated)).toHaveLength(count);
    expect(f.session.snapshot().signatures).toEqual({});
    expect(f.round.snapshot().reserved).toHaveLength(1);
    await f.session.cancel();
    expect(f.round.snapshot().reserved).toHaveLength(0);
  },
);

test('stage-entry timestamps survive local responses and reset for a genuinely new stage', async () => {
  const f = await fixture();
  expect(f.session.snapshot().phaseStartedAt).toBe(10000);
  await f.receive({ type: 'welcome', pool_secret: '9', token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  f.tick(20);
  await f.receive({ type: 'vote_open', by: f.rawSeats[1].token_hash, vote_id: 'aa'.repeat(8) });
  expect(f.session.snapshot().phaseStartedAt).toBe(10020);
  f.tick(50);
  await f.session.vote(true);
  expect(f.session.snapshot().phaseStartedAt).toBe(10020);
  await f.receive({ type: 'closing', round_id: 'bb'.repeat(8), seats: f.rawSeats, deadline: 10300 });
  expect(f.session.snapshot().phaseStartedAt).toBe(10070);
  await f.session.retryBlind();
  expect(f.session.snapshot().phaseStartedAt).toBe(10070);
  expect(f.session.snapshot().deadline).toBe(10300);
});

test.each(outputTimeoutCases)(
  'sanitized output progress $type/$count never exposes blinded state or invents creator acceptance',
  async ({ type, count }) => {
    const f = await outputTimeoutFixture(type, count);
    expect(f.session.snapshot().outputProgress).toEqual({ total: count, submitted: 0, prepared: false });
    await f.receive(f.reply);
    expect(f.session.snapshot().outputProgress).toEqual({ total: count, submitted: 0, prepared: true });
    f.tick(45);
    await f.session.submitOutput();
    const snapshot = f.session.snapshot();
    expect(snapshot.outputProgress).toEqual({ total: count, submitted: count, prepared: true });
    expect(snapshot.outputStates).toBeUndefined();
    expect(snapshot.token).toBeUndefined();
    expect(snapshot.poolSecret).toBeUndefined();
    expect(snapshot.phase).toBe('closing');
    f.assertUnsigned();
  },
);

test.each(outputTimeoutCases)(
  'client preparation recovery $type/$count uses the real guarded session and cannot bypass busy or expiry',
  async ({ type, count }) => {
    const f = await outputTimeoutFixture(type, count);
    const updated = jest.fn();
    // Real orchestration + real encrypted protocol session; disposable wallet identity and offline transport.
    const client = Reflect.construct(MixingClient, [
      f.terms,
      { getID: () => 'wallet' },
      f.session,
      f.round,
      {},
      [],
      undefined,
      updated,
    ]) as MixingClient;
    const publish = f.env.publish;
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    f.env.publish = async (event, isolated) => {
      await gate;
      return publish(event, isolated);
    };
    const retry = client.retryOutputPreparation();
    await expect(client.retryOutputPreparation()).rejects.toThrow('pending');
    release();
    await retry;
    expect(updated).toHaveBeenCalledTimes(1);
    expect(f.published).toHaveLength(2);
    const bodies = f.published.map(({ event }) => JSON.parse(decrypt(event.content, conversationKey(pool, pub(pool)))));
    expect(bodies[1]).toEqual(bodies[0]); // same request, not a new output identity or round
    f.assertUnsigned();
    f.tick(300);
    await expect(client.retryOutputPreparation()).rejects.toThrow();
    expect(f.published).toHaveLength(2);
    expect(updated).toHaveBeenCalledTimes(1);
  },
);

describe('v5 payment-pool participant compatibility', () => {
  test.each(['p2wpkh', 'p2tr'] as const)(
    '%s joins 1/2/5-output payment pools with differing creator payment counts',
    async type => {
      for (const count of [1, 2, 5]) {
        for (const payCount of [1, 2, 5]) {
          const payments = Array.from({ length: payCount }, (_, i) => (i === payCount - 1 ? count * 10000 - 330 * (payCount - 1) : 330));
          const f = await fixture(type, count, 2, payments);
          await f.advance();
          expect(f.session.snapshot().phase).toBe('review');
          expect(f.round.snapshot().phase).toBe('review');
          expect(f.session.snapshot().signatures).toEqual({});
          expect(f.session.reviewSummary()).toMatchObject({ count, total: count * 10000 });
          expect(f.published.filter(p => p.isolated)).toHaveLength(count);
          let actualPlan: Plan | undefined;
          await f.session.signApproved(f.round.snapshot().commitment!, async p => {
            actualPlan = p;
            const c = f.rawSeats[0].coin;
            return new Map([
              [
                outpoint(c),
                f.signature(
                  p,
                  p.coins.findIndex(x => outpoint(x) === outpoint(c)),
                ),
              ],
            ]);
          });
          const p = actualPlan!;
          expect(p.payments!.map(o => o.value).sort((a, b) => a - b)).toEqual([...payments].sort((a, b) => a - b));
          const peer = f.rawSeats[1].coin;
          await f.receive(
            {
              type: 'sig',
              outpoint: outpoint(peer),
              sig: f.signature(
                p,
                p.coins.findIndex(x => outpoint(x) === outpoint(peer)),
              ),
            },
            false,
            pool,
          );
          expect(Transaction.fromHex(f.session.completedTransaction()).outs).toHaveLength(count + payCount + 2);
          expect(f.round.snapshot().reserved).toHaveLength(1);
        }
      }
    },
    120000,
  );
  test('requires the creator in a v5 closing roster even when enough other people remain', async () => {
    const f = await fixture('p2wpkh', 2, 4, [12345, 7655]);
    await f.receive({ type: 'welcome', pool_secret: pool.toString('hex'), token: 'ab'.repeat(16), seq: 1 }, true);
    await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
    await expect(
      f.receive({ type: 'closing', round_id: 'aa'.repeat(8), seats: f.rawSeats.filter((_, i) => i !== 1), deadline: 10300 }),
    ).rejects.toThrow();
    expect(f.session.snapshot().phase).toBe('open');
    expect(f.published).toHaveLength(0);
    expect(f.round.snapshot().phase).toBe('joined');
  });
});

describe('v5 authenticated output rejection boundaries', () => {
  test.each([
    ['missing payments', (b: Record<string, unknown>) => ({ ...b, payments: undefined })],
    [
      'changed amount',
      (b: Record<string, unknown>) => ({
        ...b,
        payments: (b.payments as { script: string; value: number }[]).map((p, i) => ({ ...p, value: p.value + (i === 0 ? 1 : -1) })),
      }),
    ],
    [
      'duplicate payment',
      (b: Record<string, unknown>) => ({ ...b, payments: [(b.payments as unknown[])[0], (b.payments as unknown[])[0]] }),
    ],
    [
      'mixed overlap',
      (b: Record<string, unknown>) => ({
        ...b,
        payments: (b.payments as { script: string; value: number }[]).map((p, i) => ({
          ...p,
          script: i === 0 ? (b.scripts as string[])[0] : p.script,
        })),
      }),
    ],
    ['too many mixed outputs', (b: Record<string, unknown>) => ({ ...b, scripts: [...(b.scripts as string[]), '0014' + 'ef'.repeat(20)] })],
  ])('%s does not reach review or invoke signing', async (_name, alter) => {
    const f = await fixture('p2wpkh', 2, 2, [7123, 12877]);
    await expect(f.advance(undefined, alter as (b: Record<string, unknown>) => Record<string, unknown>)).rejects.toThrow();
    expect(f.session.snapshot().phase).toBe('closing');
    expect(f.round.snapshot().phase).toBe('joined');
    expect(f.round.snapshot().reserved).toHaveLength(1);
    const signer = jest.fn();
    await expect(f.session.signApproved('unapproved', signer)).rejects.toThrow();
    expect(signer).not.toHaveBeenCalled();
  });
});

test.each(['p2wpkh', 'p2tr'] as const)('v5 %s one-output blind exchange uses the upstream scalar fields', async type => {
  const f = await fixture(type, 1, 2, [330, 9670]);
  await f.receive({ type: 'welcome', pool_secret: pool.toString('hex'), token: 'ab'.repeat(16), seq: 1 }, true);
  await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
  await f.receive({ type: 'closing', round_id: 'aa'.repeat(8), seats: f.rawSeats, deadline: 10300 });
  const request = JSON.parse(decrypt(f.published[0].event.content, conversationKey(pool, pub(pool))));
  // Pinned upstream PoolSession.blindedList/sendBlind choose by perPerson, not by version.
  expect(request.blinded).toEqual(expect.stringMatching(/^[0-9a-f]{512}$/));
  expect(Array.isArray(request.blinded)).toBe(false);
  const sig = modPow(BigInt('0x' + request.blinded), d, n)
    .toString(16)
    .padStart(512, '0');
  await f.receive({ type: 'blind_sig', round_id: request.round_id, token_hash: f.rawSeats[0].token_hash, sig });
  expect(f.session.snapshot().outputStates).toBeUndefined();
  expect(f.session.snapshot().outputProgress).toEqual({ total: 1, submitted: 0, prepared: true });
  expect(f.session.snapshot().outputSignature).toEqual(expect.stringMatching(/^[0-9a-f]{512}$/));
  expect(f.session.snapshot().outputNotBefore).toBeGreaterThanOrEqual(10000);
  expect(f.session.snapshot().phase).toBe('closing');
  expect(f.session.snapshot().signatures).toEqual({});
});

describe('newer creator closing recovery', () => {
  const firstId = 'aa'.repeat(8);
  const nextId = 'bb'.repeat(8);
  const start = async (outputs = 1, payments?: number[], type: Coin['type'] = 'p2wpkh') => {
    const f = await fixture(type, outputs, 2, payments);
    await f.receive(
      {
        type: 'welcome',
        pool_secret: pool.toString('hex'),
        token: 'ab'.repeat(16),
        seq: 1,
      },
      true,
    );
    await f.receive({ type: 'roster', seq: 1, seats: f.rawSeats });
    await f.receive({
      type: 'closing',
      round_id: firstId,
      seats: f.rawSeats,
      deadline: 10300,
    });
    return f;
  };
  const body = (f: Awaited<ReturnType<typeof start>>, extra: Record<string, unknown> = {}) => ({
    type: 'closing',
    round_id: nextId,
    seats: f.rawSeats,
    deadline: 10315,
    again: 0,
    ...extra,
  });
  const request = (f: Awaited<ReturnType<typeof start>>, i: number) =>
    JSON.parse(decrypt(f.published[i].event.content, conversationKey(pool, pub(pool))));
  const saved = (f: Awaited<ReturnType<typeof start>>) => (f.env.saveEncrypted as jest.Mock).mock.calls.slice(-1)[0][0];
  const respond = async (f: Awaited<ReturnType<typeof start>>, id: string) => {
    const blind = request(f, 0).blinded;
    const sigs = (Array.isArray(blind) ? blind : [blind]).map((b: string) =>
      modPow(BigInt('0x' + b), d, n)
        .toString(16)
        .padStart(512, '0'),
    );
    await f.receive({
      type: 'blind_sig',
      round_id: id,
      token_hash: f.rawSeats[0].token_hash,
      ...(Array.isArray(blind) ? { sigs } : { sig: sigs[0] }),
    });
  };

  test.each([
    ['p2wpkh', 1, undefined],
    ['p2tr', 1, undefined],
    ['p2wpkh', 2, undefined],
    ['p2tr', 5, undefined],
    ['p2wpkh', 1, [4000, 6000]],
    ['p2tr', 1, [4000, 6000]],
    ['p2wpkh', 2, [10000, 10000]],
    ['p2tr', 5, [50000]],
  ] as const)('preserves blinded outputs and changes only round authentication: %s %i %j', async (type, outputs, payments) => {
    const f = await start(outputs, payments ? [...payments] : undefined, type);
    const initial = saved(f),
      journal = f.round.snapshot();
    f.tick(15);
    await f.receive(body(f));
    expect(f.session.snapshot()).toMatchObject({
      roundId: nextId,
      phase: 'closing',
      deadline: 10300,
      phaseStartedAt: 10000,
    });
    expect(saved(f).outputStates).toEqual(initial.outputStates);
    expect(f.round.snapshot()).toEqual(journal);
    const before = request(f, 0),
      after = request(f, 1);
    expect(after.blinded).toEqual(before.blinded);
    expect(after.mac).not.toBe(before.mac);
    const bytes = (Array.isArray(after.blinded) ? after.blinded : [after.blinded]).map((b: string) => Buffer.from(b, 'hex'));
    expect(after.mac).toBe(memberMac('ab'.repeat(16), 'blind', nextId, hash(Buffer.concat(bytes)).toString('hex')));
    await respond(f, firstId);
    expect(f.session.snapshot().outputProgress?.prepared).toBe(false);
    await respond(f, nextId);
    expect(f.session.snapshot().outputProgress?.prepared).toBe(true);
    f.tick(45);
    await f.session.submitOutput();
    const publications = f.published
      .filter(p => p.isolated)
      .map(p => JSON.parse(decrypt(p.event.content, conversationKey(creator, p.event.pubkey))));
    expect(publications).toHaveLength(outputs);
    expect(publications.every(p => p.round_id === nextId)).toBe(true);
    expect(f.round.snapshot().phase).toBe('joined');
    expect(f.session.snapshot().signatures).toEqual({});
  });

  test('accepts upstream omitted again=0 and successive 15-second closings without extending the deadline', async () => {
    const f = await start();
    for (let i = 1; i <= 3; i++) {
      f.tick(15);
      await f.receive(
        body(f, {
          again: undefined,
          round_id: i.toString(16).repeat(16),
          deadline: 10300 + i * 15,
        }),
      );
    }
    expect(f.published).toHaveLength(4);
    expect(f.session.snapshot()).toMatchObject({
      roundId: '3'.repeat(16),
      deadline: 10300,
      phaseStartedAt: 10000,
    });
    expect(new Set(f.published.map((_, i) => request(f, i).blinded)).size).toBe(1);
  });

  test('rejects equal/older timestamps, reused IDs, and participant-forged creator messages', async () => {
    const f = await start();
    await f.receive(body(f));
    f.tick(15);
    await f.receive(body(f), false, pool);
    expect(f.published).toHaveLength(1);
    await f.receive(body(f));
    const current = f.session.snapshot();
    f.tick(15);
    await f.receive(body(f, { round_id: firstId }));
    await f.receive(body(f));
    await f.receive(body(f, { round_id: 'cc'.repeat(8) }), false, creator, 10014);
    expect(f.session.snapshot()).toEqual(current);
    expect(f.published).toHaveLength(2);
  });

  test.each([1, -1, '0', null, false])('ignores unsupported again value %j', async again => {
    const f = await start();
    f.tick(15);
    await f.receive(body(f, { again }));
    expect(f.session.snapshot().roundId).toBe(firstId);
    expect(f.published).toHaveLength(1);
  });

  test('does not switch after a blind signature or after its original deadline', async () => {
    const f = await start();
    await respond(f, firstId);
    f.tick(15);
    await f.receive(body(f));
    expect(f.session.snapshot().roundId).toBe(firstId);
    const expired = await start();
    expired.tick(300);
    await expect(expired.receive(body(expired, { deadline: 10600 }))).rejects.toThrow('expired');
    expect(expired.session.snapshot().roundId).toBe(firstId);
    expect(expired.published).toHaveLength(1);
  });

  test('rechecks unspent inputs and rejects changed participant commitments', async () => {
    const f = await start();
    f.tick(15);
    const changed = f.rawSeats.map(s => ({ ...s }));
    changed[1].token_hash = 'ef'.repeat(32);
    await expect(f.receive(body(f, { seats: changed }))).rejects.toThrow('roster');
    expect(f.session.snapshot().roundId).toBe(firstId);
    const observe = f.env.observe;
    f.env.observe = async coins => new Map([...(await observe(coins))].map(([k, v]) => [k, { ...v, unspent: false }]));
    await expect(f.receive(body(f))).rejects.toThrow();
    expect(f.session.snapshot().roundId).toBe(firstId);
    expect(f.published).toHaveLength(1);
  });

  test('persists replacement before publishing; failed saves leave the original round intact', async () => {
    const f = await start();
    f.tick(15);
    (f.env.saveEncrypted as jest.Mock).mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(f.receive(body(f))).rejects.toThrow('Session persistence failed');
    expect(f.session.snapshot().roundId).toBe(firstId);
    expect(f.published).toHaveLength(1);
    const publish = f.env.publish;
    f.env.publish = async (event, isolated) => {
      expect(saved(f).roundId).toBe(nextId);
      await publish(event, isolated);
    };
    await f.receive(body(f));
    expect(f.published).toHaveLength(2);
  });

  test('a failed resend can retry the durable new round without regenerating blinded data', async () => {
    const f = await start();
    const publish = f.env.publish;
    f.env.publish = async () => {
      throw new Error('relay unavailable');
    };
    f.tick(15);
    await expect(f.receive(body(f))).rejects.toThrow('relay unavailable');
    expect(f.session.snapshot().roundId).toBe(nextId);
    f.env.publish = publish;
    await f.session.retryBlind();
    expect(request(f, 1).round_id).toBe(nextId);
    expect(request(f, 1).blinded).toEqual(request(f, 0).blinded);
  });
  test('backend validation crossing the deadline cannot publish a replacement', async () => {
    const f = await start();
    f.tick(15);
    const observe = f.env.observe;
    f.env.observe = async coins => {
      const result = await observe(coins);
      f.tick(286);
      return new Map([...result].map(([k, v]) => [k, { ...v, checkedAt: f.env.now() }]));
    };
    await expect(f.receive(body(f))).rejects.toThrow();
    expect(f.session.snapshot().roundId).toBe(firstId);
    expect(f.published).toHaveLength(1);
  });

  test.each([10015, 10316, '10300', -1, 10015.5])('invalid replacement deadline %j sends nothing', async deadline => {
    const f = await start();
    f.tick(15);
    await expect(f.receive(body(f, { deadline }))).rejects.toThrow('deadline');
    expect(f.session.snapshot().roundId).toBe(firstId);
    expect(f.published).toHaveLength(1);
  });

  test('reordered identical seats retain the same outputs; earlier valid deadlines shorten the window', async () => {
    const f = await start();
    f.tick(15);
    await f.receive(body(f, { seats: [...f.rawSeats].reverse(), deadline: 10200 }));
    expect(f.session.snapshot()).toMatchObject({ roundId: nextId, deadline: 10200 });
    expect(request(f, 1).blinded).toEqual(request(f, 0).blinded);
  });

  test('storage crossing expiry does not send a now-expired replacement', async () => {
    const f = await start();
    f.tick(15);
    (f.env.saveEncrypted as jest.Mock).mockImplementationOnce(async () => {
      f.tick(286);
    });
    await expect(f.receive(body(f))).rejects.toThrow('expired');
    expect(f.session.snapshot().roundId).toBe(nextId);
    expect(f.published).toHaveLength(1);
  });
});
