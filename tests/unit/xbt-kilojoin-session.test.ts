import { participantFailure, relayFailureMessage } from '../../class/xbt/kilojoin/relay-error';
import { KilojoinRelay } from '../../class/xbt/kilojoin/relay';
import { generateKeyPairSync, randomBytes } from 'crypto';
import { ECPairFactory } from 'ecpair';
import { crypto as bitcoinCrypto, Transaction } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { ParticipantSession, SessionEnvironment } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms, tokenHash, changeMessage } from '../../class/xbt/kilojoin/protocol';
import { Coin, coinScript, digest, outpoint, ownershipMessage, Plan, change } from '../../class/xbt/kilojoin/transaction';
import { parseSeat } from '../../class/xbt/kilojoin/roster';
import { conversationKey, decrypt, encrypt, NostrEvent, signEvent } from '../../class/xbt/kilojoin/crypto';
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
async function fixture(type: Coin['type'] = 'p2wpkh', outputs = 1) {
  let now = 10000,
    counter = 0;
  const script = (i: number) => (type === 'p2wpkh' ? '0014' + i.toString(16).repeat(40) : '5120' + i.toString(16).repeat(64));
  const terms: Terms = {
    v: outputs === 1 ? 3 : 4,
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
    max_peers: 5,
    max_inputs: 10,
    private: false,
    timeout: 12000,
    state: 'open',
    peers: 2,
    script: type,
  };
  const token = 'ab'.repeat(16),
    keys = [secret(1), secret(2)];
  const rawSeats = keys.map((key, i) => {
    const coin: Coin = {
      txid: (i + 1).toString(16).repeat(64),
      vout: 0,
      value: outputs === 1 ? 50000 : 100000,
      pubkey: Buffer.from(ecc.pointFromScalar(key, true)!).toString('hex'),
      type,
    };
    const joinPub = i === 0 ? pub(join) : pub(pool);
    return {
      coin,
      change_script: script(i + 3),
      change_value: change(coin.value, terms.denomination, terms.fee_rate, 1, type, outputs)!,
      token_hash: i === 0 ? tokenHash(token) : 'cd'.repeat(32),
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
  const receive = async (body: Record<string, unknown>, direct = false, sender = creator) => {
    const recipient = direct ? pub(join) : pub(pool);
    await session.receive(
      signEvent(
        {
          kind: 2023,
          created_at: now,
          tags: [['p', recipient]],
          content: encrypt(JSON.stringify({ ...body, test_nonce: ++counter }), conversationKey(sender, recipient), randomBytes(32)),
        },
        sender,
        randomBytes(32),
      ),
    );
  };
  const advance = async (alter: (body: Record<string, unknown>) => Record<string, unknown> = body => body) => {
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
    await receive({ type: 'outputs', round_id: request.round_id, scripts: Array.from({ length: outputs * 2 }, (_, i) => script(5 + i)) });
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
    expect(f.session.snapshot()).toEqual(before);
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
    expect(f.session.snapshot()).toEqual(before);
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
  expect(f.session.snapshot()).toEqual(accepted);
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
  const code = { proof: 'KJ-PROOF', change: 'KJ-CHANGE', chain: 'KJ-CHAIN', 'own-seat': 'KJ-OWN-SEAT' }[fault];
  expect(relayFailureMessage(participantFailure(error))).toContain(`Diagnostic: ${code}.`);
  expect(f.session.snapshot()).toEqual(before);
  expect(f.round.snapshot().reserved).toHaveLength(1);
  expect(f.published).toHaveLength(0);
});
