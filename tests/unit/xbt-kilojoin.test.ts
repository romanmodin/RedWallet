import { Round } from '../../class/xbt/kilojoin/round';
import { Transaction } from 'bitcoinjs-lib';
import vectors from './fixtures/kilojoin-vectors.json';
import rsa from './fixtures/kilojoin-rfc9474.json';
import * as wire from '../../class/xbt/kilojoin/crypto';
import * as tx from '../../class/xbt/kilojoin/transaction';
import * as protocol from '../../class/xbt/kilojoin/protocol';
import * as blind from '../../class/xbt/kilojoin/blind-rsa';
const h = (s: string) => Buffer.from(s, 'hex');
const raw = Transaction.fromHex(vectors.transaction.raw_tx);
const coins: tx.Coin[] = raw.ins.map((input, i) => ({
  txid: Buffer.from(input.hash).reverse().toString('hex'),
  vout: input.index,
  value: i === 0 ? 50000 : 60000,
  pubkey: Buffer.from(input.witness[1]).toString('hex'),
  type: 'p2wpkh',
}));
const outs = vectors.transaction.outputs_in_order;
const makePlan = () => tx.plan(coins.slice().reverse(), [outs[1].script, outs[0].script], [outs[3], outs[2]], 10000);
const review = (): tx.Review => ({
  mine: [coins[0]],
  mixScript: outs[1].script,
  changeScript: outs[3].script,
  maxFee: 271,
  feeRate: 2,
  seatInputs: [1, 1],
  verified: new Map(coins.map(c => [tx.outpoint(c), { value: c.value, script: tx.coinScript(c).toString('hex') }])),
});

describe('Kilojoin upstream interoperability', () => {
  test('canonical transaction, txid, both unified digests and signatures match Android byte for byte', () => {
    const p = makePlan();
    expect(tx.transaction(p).getId()).toBe(vectors.transaction.txid_before_signing);
    expect(p.outputs).toEqual(outs);
    expect(tx.digest(p, 0).toString('hex')).toBe(vectors.transaction.unified_sighash_input0);
    expect(tx.digest(p, 1).toString('hex')).toBe(vectors.transaction.unified_sighash_input1);
    expect(
      tx.assemble(
        p,
        new Map([
          [tx.outpoint(coins[0]), vectors.transaction.sig_A],
          [tx.outpoint(coins[1]), vectors.transaction.sig_B],
        ]),
      ),
    ).toBe(vectors.transaction.raw_tx);
    expect(tx.review(p, review())).toMatchObject({ fee: 542, myFee: 271 });
  });
  test('fee, ownership and protocol commitments match upstream', () => {
    expect(tx.feeShare(2)).toBe(vectors.fee_share.with_change);
    expect(tx.feeShare(2, false)).toBe(vectors.fee_share.without_change);
    expect(tx.change(50000, 10000, 2)).toBe(vectors.fee_share.change_for_50000);
    expect(tx.change(10209, 10000, 2)).toBe(0);
    expect(tx.change(10208, 10000, 2)).toBeNull();
    expect(tx.ownershipMessage(vectors.pool.id, vectors.join.join_pub, coins[1]).toString('hex')).toBe(vectors.join.ownership_hash);
    expect(tx.verifyOwnership(vectors.pool.id, vectors.join.join_pub, coins[1], vectors.join.ownership_sig_der)).toBe(true);
    expect(tx.verifyOwnership('other', vectors.join.join_pub, coins[1], vectors.join.ownership_sig_der)).toBe(false);
    expect(protocol.passwordKey(vectors.pool.id, vectors.join.password).toString('hex')).toBe(vectors.join.password_key);
    expect(protocol.passwordProof(h(vectors.join.password_key), vectors.join.join_pub)).toBe(vectors.join.password_proof);
    expect(protocol.tokenHash(vectors.join.token)).toBe(vectors.join.token_hash);
    expect(protocol.changeMessage(vectors.pool.id, [coins[1]], vectors.join.change_script, vectors.join.change_value).toString('hex')).toBe(
      vectors.join.change_hash,
    );
  });
  test('NIP44 ciphertext, shared key and signed Nostr event match upstream', () => {
    const v = vectors.channel_event;
    expect(wire.conversationKey(h(vectors.pool.pool_secret), vectors.pool.pool_pub).toString('hex')).toBe(v.conversation_key);
    expect(wire.encrypt(v.plaintext, h(v.conversation_key), h(v.nonce))).toBe(v.event.content);
    expect(wire.decrypt(v.event.content, h(v.conversation_key))).toBe(v.plaintext);
    expect(wire.verifyEvent(v.event)).toBe(true);
    expect(wire.verifyEvent({ ...v.event, content: v.event.content + 'x' })).toBe(false);
  });
  test('RFC9474 PSS encoding, blinding, unblinding and verification match upstream vector', () => {
    const pk = blind.publicKey(rsa.N + ':10001'),
      prepared = h(rsa.PREPARED_MSG),
      inv = BigInt('0x' + rsa.INV);
    expect(blind.pssEncode(prepared, pk.bits - 1, h(rsa.SALT)).toString('hex')).toBe(rsa.ENCODED_MSG);
    const result = blind.blind(
      pk,
      prepared,
      () => {
        throw new Error('unexpected entropy request');
      },
      { salt: h(rsa.SALT), r: blind.inverse(inv, pk.n) },
    );
    expect(result.blinded.toString('hex')).toBe(rsa.BLINDED_MSG);
    expect(result.inv).toBe(inv);
    expect(blind.finalize(pk, prepared, h(rsa.BLIND_SIG), inv).toString('hex')).toBe(rsa.SIG);
    expect(blind.verify(pk, h(rsa.MSG), h(rsa.SIG))).toBe(false);
    const bad = h(rsa.SIG);
    bad[100] ^= 1;
    expect(blind.verify(pk, prepared, bad)).toBe(false);
    expect(() => blind.finalize(pk, prepared, bad, inv)).toThrow();
  });
});
describe('Kilojoin adversarial boundaries', () => {
  test.each([NaN, Infinity, -1, 0, 501])('rejects fee rate %s', rate => expect(() => tx.feeShare(rate)).toThrow());
  test('duplicate input, output, input reuse and dust are rejected', () => {
    expect(() => tx.plan([coins[0], coins[0]], [outs[0].script, outs[1].script], [], 10000)).toThrow('Duplicate coin');
    expect(() => tx.plan(coins, [outs[0].script, outs[0].script], [], 10000)).toThrow('Duplicate output');
    expect(() => tx.plan(coins, [tx.coinScript(coins[0]).toString('hex'), outs[1].script], [], 10000)).toThrow('reuse');
    expect(() => tx.plan(coins, [outs[0].script, outs[1].script], [{ ...outs[2], value: 294 }], 10000)).toThrow();
  });
  test('review rejects fee-limit violations, missing coins, changed change and unverified inputs', () => {
    expect(() => tx.review(makePlan(), { ...review(), maxFee: 270 })).toThrow('fee limit');
    expect(() => tx.review(makePlan(), { ...review(), mine: [{ ...coins[0], vout: 5 }] })).toThrow('Own coin');
    expect(() => tx.review(makePlan(), { ...review(), changeScript: outs[2].script })).toThrow('change');
    expect(() => tx.review(makePlan(), { ...review(), verified: new Map() })).toThrow('Unverified');
    const r = review();
    r.verified = new Map([[tx.outpoint(coins[0]), { value: 50001, script: tx.coinScript(coins[0]).toString('hex') }]]);
    expect(() => tx.review(makePlan(), r)).toThrow('Unverified');
  });
  test('rejects changed transaction and wrong sighash signatures', () => {
    const p = makePlan();
    p.outputs[0].value--;
    expect(tx.verifySignature(p, 0, vectors.transaction.sig_A)).toBe(false);
    expect(tx.verifySignature(makePlan(), 0, vectors.transaction.sig_A.slice(0, -2) + '01')).toBe(false);
    expect(() => tx.review(p, review())).toThrow('Noncanonical');
    expect(() => tx.assemble(makePlan(), new Map())).toThrow();
  });
  test('rejects corrupted and oversized encrypted messages', () => {
    const v = vectors.channel_event,
      b = Buffer.from(v.event.content, 'base64');
    b[40] ^= 1;
    expect(() => wire.decrypt(b.toString('base64'), h(v.conversation_key))).toThrow('MAC');
    expect(() => wire.decrypt('A'.repeat(90000), h(v.conversation_key))).toThrow();
    expect(() => wire.encrypt('', h(v.conversation_key), h(v.nonce))).toThrow();
    expect(() => wire.encrypt('ok', h(v.conversation_key), Buffer.alloc(31))).toThrow();
  });
  test('accepts signed v3 pool, rejects stale, foreign-chain and older-version pools', () => {
    const terms = {
      v: 3,
      app: 'kilowallet',
      network: 'blake2b',
      id: vectors.pool.id,
      public_key: vectors.pool.pool_pub,
      denomination: 10000,
      fee_rate: 2,
      min_peers: 2,
      max_peers: 5,
      private: false,
      timeout: 1791401000,
      state: 'open',
      peers: 2,
      script: 'p2wpkh',
      max_inputs: 10,
      creator: vectors.join.join_pub,
      blind_key: rsa.N + ':10001',
    };
    const sign = (t: unknown) =>
      wire.signEvent(
        {
          kind: 32022,
          created_at: 1791400000,
          tags: [
            ['d', vectors.pool.id],
            ['t', 'kilojoin'],
          ],
          content: JSON.stringify(t),
        },
        h(vectors.pool.pool_secret),
        Buffer.alloc(32),
      );
    expect(protocol.parsePool(sign(terms), 1791400000).v).toBe(3);
    expect(() => protocol.parsePool(sign({ ...terms, v: 4, outputs: 2 }), 1791400000, false)).toThrow('Unsupported');
    for (const outputs of [2, 3, 4, 5]) {
      expect(protocol.outputCount(protocol.parsePool(sign({ ...terms, v: 4, outputs }), 1791400000))).toBe(outputs);
    }
    for (const outputs of [undefined, 0, 1, 6, 2.5]) {
      expect(() => protocol.parsePool(sign({ ...terms, v: 4, outputs }), 1791400000, true)).toThrow();
    }
    expect(() => protocol.parsePool(sign({ ...terms, outputs: 2 }), 1791400000)).toThrow();
    expect(() => protocol.parsePool(sign({ ...terms, network: 'bitcoin' }), 1791400000)).toThrow();
    expect(() => protocol.parsePool(sign({ ...terms, v: 2 }), 1791400000)).toThrow();
    expect(() => protocol.parsePool(sign(terms), 1791403000)).toThrow();
    expect(() => protocol.parsePool(sign({ ...terms, creator: terms.public_key }), 1791400000)).toThrow();
    expect(() => protocol.parsePool(sign({ ...terms, fee_rate: NaN }), 1791400000)).toThrow();
  });
  test('experimental participation is available for explicit opt-in', () => expect(protocol.LIVE_JOIN_ENABLED).toBe(true));
});

describe('offline round lifecycle', () => {
  const start = async (save = jest.fn(async () => {})) =>
    Round.join('test-wallet', vectors.pool.id, [tx.outpoint(coins[0])], 100, 1, { save });
  test('requires explicit exact review approval; signed cancellation keeps coins reserved', async () => {
    const r = await start();
    await expect(r.beforeSigning('fake', 2)).rejects.toThrow();
    const snapshot = await r.review(makePlan(), review(), 2);
    await expect(r.approve('wrong', 3)).rejects.toThrow('Review changed');
    await r.approve(snapshot.commitment!, 3);
    await r.beforeSigning(snapshot.commitment!, 4);
    await r.cancel();
    expect(r.snapshot().phase).toBe('uncertain');
    expect(r.snapshot().reserved).toHaveLength(1);
    await expect(r.confirm(snapshot.reviewedId!, 0)).rejects.toThrow();
    await expect(r.confirm('00'.repeat(32), 1)).rejects.toThrow();
    await r.confirm(snapshot.reviewedId!, 1);
    expect(r.snapshot().reserved).toHaveLength(0);
  });
  test('restart retains signed reservations, removes stale approval and rejects damaged journals', async () => {
    const r = await start();
    const reviewed = await r.review(makePlan(), review(), 2);
    await r.approve(reviewed.commitment!, 3);
    const aborted = await Round.restore(r.snapshot(), 'test-wallet', 200, { save: async () => {} });
    expect(aborted.snapshot().phase).toBe('aborted');
    await r.beforeSigning(reviewed.commitment!, 4);
    const recovered = await Round.restore(r.snapshot(), 'test-wallet', 200, { save: async () => {} });
    expect(recovered.snapshot().phase).toBe('uncertain');
    expect(recovered.snapshot().reserved).toEqual(r.snapshot().reserved);
    await expect(
      Round.restore({ ...r.snapshot(), reviewedId: 'ff'.repeat(32) }, 'test-wallet', 200, { save: async () => {} }),
    ).rejects.toThrow('commitment');
    await expect(Round.restore(r.snapshot(), 'other-wallet', 200, { save: async () => {} })).rejects.toThrow('wallet');
    await expect(
      Round.restore(r.snapshot(), 'test-wallet', 200, {
        save: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
  });
  test('unsigned cancellation releases reservation; expired approval is rejected', async () => {
    const r = await start();
    const s = await r.review(makePlan(), review(), 2);
    await expect(r.approve(s.commitment!, 100)).rejects.toThrow('expired');
    await r.cancel();
    expect(r.snapshot().phase).toBe('aborted');
    expect(r.snapshot().reserved).toEqual([]);
  });
  test('failed durable write prevents signature state advancing', async () => {
    const save = jest.fn(async () => {}),
      r = await start(save),
      s = await r.review(makePlan(), review(), 2);
    await r.approve(s.commitment!, 3);
    save.mockRejectedValueOnce(new Error('disk full'));
    await expect(r.beforeSigning(s.commitment!, 4)).rejects.toThrow('disk full');
    expect(r.snapshot().phase).toBe('approved');
  });
  test('snapshots cannot mutate reservations or approve changed selected inputs', async () => {
    const r = await start();
    r.snapshot().reserved.length = 0;
    expect(r.snapshot().reserved).toHaveLength(1);
    await expect(r.review(makePlan(), { ...review(), mine: [coins[1]] }, 2)).rejects.toThrow('Selected coins');
  });
});
