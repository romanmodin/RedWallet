import { generateKeyPairSync, randomBytes } from 'crypto';
import { ECPairFactory } from 'ecpair';
import { crypto as bitcoinCrypto, Transaction } from 'bitcoinjs-lib';
import ecc from '../../blue_modules/noble_ecc';
import { ParticipantSession, SessionEnvironment } from '../../class/xbt/kilojoin/session';
import { Round } from '../../class/xbt/kilojoin/round';
import { Terms, tokenHash } from '../../class/xbt/kilojoin/protocol';
import { Coin, coinScript, digest, outpoint, ownershipMessage, Plan } from '../../class/xbt/kilojoin/transaction';
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
async function fixture(type: Coin['type'] = 'p2wpkh') {
  let now = 10000,
    counter = 0;
  const script = (i: number) => (type === 'p2wpkh' ? '0014' + i.toString(16).repeat(40) : '5120' + i.toString(16).repeat(64));
  const terms: Terms = {
    v: 3,
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
      value: 50000,
      pubkey: Buffer.from(ecc.pointFromScalar(key, true)!).toString('hex'),
      type,
    };
    const joinPub = i === 0 ? pub(join) : pub(pool);
    return {
      coin,
      change_script: script(i + 3),
      change_value: type === 'p2wpkh' ? 39729 : 39702,
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
  const session = new ParticipantSession(terms, own, join, script(5), 400, round, env);
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
  const advance = async () => {
    await receive({ type: 'welcome', pool_secret: pool.toString('hex'), token, seq: 1 }, true);
    await receive({ type: 'roster', seq: 1, seats: rawSeats });
    await receive({ type: 'closing', round_id: 'aa'.repeat(8), seats: rawSeats, deadline: now + 300 });
    const request = JSON.parse(decrypt(published[0].event.content, conversationKey(pool, pub(pool))));
    const blindSignature = modPow(BigInt('0x' + request.blinded), d, n)
      .toString(16)
      .padStart(512, '0');
    await receive({ type: 'blind_sig', round_id: request.round_id, token_hash: own.token_hash, sig: blindSignature });
    now += 45;
    await session.submitOutput();
    await receive({ type: 'outputs', round_id: request.round_id, scripts: [script(5), script(6)] });
  };
  const signature = (p: Plan, index: number) => {
    const key = keys[Number(p.coins[index].txid[0]) - 1];
    if (type === 'p2wpkh') return Buffer.concat([ecc.signDER(digest(p, index), key), Buffer.from([0x21])]).toString('hex');
    const internal = ecc.pointFromScalar(key, true)!.slice(1);
    const tweaked = ECPair.fromPrivateKey(key).tweak(bitcoinCrypto.taggedHash('TapTweak', internal));
    return Buffer.concat([tweaked.signSchnorr!(digest(p, index)), Buffer.from([0x21])]).toString('hex');
  };
  return { session, round, env, advance, receive, published, signature, rawSeats };
}
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
  await expect(f.session.signApproved(f.session.reviewed().commitment!, signer)).rejects.toThrow('keychain unavailable');
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
