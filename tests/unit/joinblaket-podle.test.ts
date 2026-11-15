import assert from 'assert';

import {
  bindsTo,
  commitmentWire,
  formatUtxoList,
  generate,
  nonceHash,
  numsPoint,
  parseRevelation,
  parseUtxo,
  parseUtxoList,
  revelation,
  rfc6979Nonce,
  verify,
} from '../../class/joinblaket/podle';

const podle = require('../fixtures/joinblaket/xbt-taker-vectors.json').podle;

const hex = (s: string): Buffer => Buffer.from(s, 'hex');
const TXID = 'e2aabbcd6e966a907a1ce38d95120cf32fa1e14e2ec29fecd8cffcc232a37143';

describe('JoinBlaket PoDLE', () => {
  it('derives the pinned NUMS points', () => {
    for (const [i, expected] of Object.entries<string>(podle.nums_points)) {
      assert.strictEqual(numsPoint(Number(i)).toString('hex'), expected);
    }
    // Returned buffers are copies: mutating one must not poison the cache.
    const a = numsPoint(0);
    a.fill(0);
    assert.strictEqual(numsPoint(0).toString('hex'), podle.nums_points['0']);
    assert.throws(() => numsPoint(-1));
    assert.throws(() => numsPoint(256));
    assert.throws(() => numsPoint(1.5));
    assert.strictEqual(numsPoint(255).length, 33);
  });

  it('reproduces every pinned proof byte for byte, with the pinned nonce', () => {
    const key = hex(podle.private_key);
    for (const proof of podle.proofs) {
      assert.strictEqual(proof.J, numsPoint(proof.index).toString('hex'));
      const c = generate(key, podle.utxo, proof.index);
      assert.strictEqual(c.p.toString('hex'), proof.P);
      assert.strictEqual(c.p2.toString('hex'), proof.P2);
      assert.strictEqual(c.commitment.toString('hex'), proof.commitment);
      assert.strictEqual(commitmentWire(c), proof.commitment_wire);
      assert.strictEqual(c.e.toString('hex'), proof.e);
      assert.strictEqual(c.s.toString('hex'), proof.s);
      assert.strictEqual(c.utxo, podle.utxo);
      assert.strictEqual(c.index, proof.index);

      const h = nonceHash(podle.utxo, proof.index, c.p, c.p2);
      assert.strictEqual(rfc6979Nonce(key, h).toString('hex'), proof.nonce_k);
    }
    assert.strictEqual(key.toString('hex'), podle.private_key, 'generate must not mutate the key');
  });

  it('verifies every pinned proof at its index, and only with the right commitment', () => {
    for (const proof of podle.proofs) {
      const args = [hex(proof.P), hex(proof.P2), hex(proof.s), hex(proof.e), hex(proof.commitment)] as const;
      assert.strictEqual(verify(...args, [proof.index]), proof.verify);
      assert.strictEqual(
        verify(
          ...args,
          Array.from({ length: 10 }, (_, i) => i),
        ),
        true,
      );
    }
  });

  it('restricts verification to the accepted index range', () => {
    const last = podle.proofs[podle.proofs.length - 1];
    const args = [hex(last.P), hex(last.P2), hex(last.s), hex(last.e), hex(last.commitment)] as const;
    assert.strictEqual(verify(...args, [last.index]), true);
    if (last.index >= 3) assert.strictEqual(verify(...args), false, 'default indices are 0..2');
    assert.strictEqual(verify(...args, []), false);
    assert.strictEqual(verify(...args, [-1]), false);
    assert.strictEqual(verify(...args, [256]), false);
    assert.strictEqual(verify(...args, new Array(257).fill(0)), false);
  });

  it('rejects tampered or malformed proofs and never throws', () => {
    const proof = podle.proofs[0];
    const good = {
      p: hex(proof.P),
      p2: hex(proof.P2),
      s: hex(proof.s),
      e: hex(proof.e),
      c: hex(proof.commitment),
    };
    assert.strictEqual(verify(good.p, good.p2, good.s, good.e, good.c), true);

    const flip = (b: Buffer, i = 5): Buffer => {
      const copy = Buffer.from(b);
      copy[i] = (copy[i] + 1) % 256;
      return copy;
    };
    assert.strictEqual(verify(good.p, good.p2, flip(good.s, 31), good.e, good.c), false);
    assert.strictEqual(verify(good.p, good.p2, good.s, flip(good.e), good.c), false);
    assert.strictEqual(verify(good.p, good.p2, good.s, good.e, flip(good.c)), false);
    assert.strictEqual(verify(good.p, flip(good.p2, 20), good.s, good.e, good.c), false);
    assert.strictEqual(verify(flip(good.p, 20), good.p2, good.s, good.e, good.c), false);
    // Swapped P / P2 and a proof against a different NUMS index must not verify at index 0.
    assert.strictEqual(verify(good.p2, good.p, good.s, good.e, good.c), false);
    const other = podle.proofs[1];
    assert.strictEqual(verify(hex(other.P), hex(other.P2), hex(other.s), hex(other.e), hex(other.commitment), [0]), false);

    // s = 0 and s >= n, e = 0
    assert.strictEqual(verify(good.p, good.p2, Buffer.alloc(32), good.e, good.c), false);
    assert.strictEqual(
      verify(good.p, good.p2, hex('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141'), good.e, good.c),
      false,
    );
    assert.strictEqual(verify(good.p, good.p2, good.s, Buffer.alloc(32), good.c), false);
    // Wrong sizes, uncompressed / x-only / off-curve points, wrong types.
    assert.strictEqual(verify(good.p.subarray(0, 32), good.p2, good.s, good.e, good.c), false);
    assert.strictEqual(verify(good.p, good.p2, good.s.subarray(1), good.e, good.c), false);
    assert.strictEqual(verify(Buffer.concat([Buffer.from([4]), Buffer.alloc(32, 1)]), good.p2, good.s, good.e, good.c), false);
    assert.strictEqual(verify(good.p, good.p2, good.s, good.e, good.c, 'x' as unknown as number[]), false);
    assert.strictEqual(verify('a' as unknown as Buffer, good.p2, good.s, good.e, good.c), false);
    const offCurve = Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 0xff)]);
    assert.strictEqual(verify(offCurve, good.p2, good.s, good.e, good.c), false);
  });

  it('round-trips fresh keys and rejects invalid keys / utxos in generate', () => {
    const key = Buffer.alloc(32, 7);
    const c = generate(key, `${TXID}:3`, 2);
    assert.strictEqual(verify(c.p, c.p2, c.s, c.e, c.commitment, [2]), true);
    assert.strictEqual(verify(c.p, c.p2, c.s, c.e, c.commitment, [0, 1]), false);
    assert.deepStrictEqual(generate(key, `${TXID}:3`, 2).s, c.s, 'deterministic');
    assert.strictEqual(key.toString('hex'), '07'.repeat(32));

    assert.throws(() => generate(Buffer.alloc(32), `${TXID}:3`, 0), /private key/);
    assert.throws(() => generate(hex('ff'.repeat(32)), `${TXID}:3`, 0), /private key/);
    assert.throws(() => generate(Buffer.alloc(31, 1), `${TXID}:3`, 0), /private key/);
    assert.throws(() => generate(key, `${TXID}:3`, 256), /index/);
    assert.throws(() => generate(key, `${TXID}:-1`, 0), /vout/);
    assert.throws(() => generate(key, `${TXID}:3:0014${'00'.repeat(20)}:5`, 0), /Legacy/);
    assert.throws(() => generate(key, 'nonsense', 0));
  });

  it('bounds the RFC 6979 retries', () => {
    const key = hex(podle.private_key);
    const h = Buffer.alloc(32, 9);
    assert.strictEqual(rfc6979Nonce(key, h, 0).length, 32);
    assert.notStrictEqual(rfc6979Nonce(key, h, 1).toString('hex'), rfc6979Nonce(key, h, 0).toString('hex'));
    assert.throws(() => rfc6979Nonce(key, h, 1_000_000));
    assert.throws(() => rfc6979Nonce(key, h, -1));
    assert.throws(() => rfc6979Nonce(key, Buffer.alloc(31)));
  });

  it('builds and parses the legacy and extended revelations', () => {
    const key = hex(podle.private_key);
    const c = generate(key, podle.utxo, 0);
    assert.strictEqual(revelation(c), podle.revelation_legacy);
    const spk = podle.p2wpkh_scriptpubkey;
    assert.strictEqual(revelation(c, spk, 961650), podle.revelation_extended);

    const legacy = parseRevelation(podle.revelation_legacy);
    assert.strictEqual(legacy.txid, TXID);
    assert.strictEqual(legacy.vout, 1);
    assert.strictEqual(legacy.scriptPubKeyHex, undefined);
    assert.strictEqual(legacy.height, undefined);
    assert.strictEqual(legacy.p.toString('hex'), podle.proofs[0].P);
    assert.strictEqual(legacy.p2.toString('hex'), podle.proofs[0].P2);
    assert.strictEqual(legacy.s.toString('hex'), podle.proofs[0].s);
    assert.strictEqual(legacy.e.toString('hex'), podle.proofs[0].e);

    const extended = parseRevelation(podle.revelation_extended);
    assert.strictEqual(extended.scriptPubKeyHex, spk);
    assert.strictEqual(extended.height, 961650);
    assert.strictEqual(verify(extended.p, extended.p2, extended.s, extended.e, hex(podle.proofs[0].commitment), [0]), true);
  });

  it('rejects malformed revelations', () => {
    const fields = podle.revelation_legacy.split('|');
    const join = (f: string[]): string => f.join('|');
    assert.throws(() => parseRevelation(join(fields.slice(0, 4))), /5 fields/);
    assert.throws(() => parseRevelation(join([...fields, 'aa'])), /5 fields/);
    assert.throws(() => parseRevelation(join([fields[0], fields[1].slice(2), fields[2], fields[3], fields[4]])), /length/);
    assert.throws(() => parseRevelation(join([fields[0], fields[1], fields[2], fields[3] + '00', fields[4]])), /length/);
    assert.throws(() => parseRevelation(join([fields[0], 'zz' + fields[1].slice(2), fields[2], fields[3], fields[4]])), /hex/);
    assert.throws(() => parseRevelation(join(['badutxo', ...fields.slice(1)])));
    assert.throws(() => parseRevelation('a'.repeat(5_000)));
    assert.throws(() => parseRevelation(undefined as unknown as string));
  });

  it('parses and bounds UTXO references', () => {
    assert.deepStrictEqual({ ...parseUtxo(`${TXID}:0`) }, { txid: TXID, vout: 0 });
    assert.strictEqual(parseUtxo(`${TXID}:4294967295`).vout, 4294967295);
    assert.deepStrictEqual(
      { ...parseUtxo(`${TXID.toUpperCase()}:7:0014${'ab'.repeat(20)}:100`) },
      {
        txid: TXID,
        vout: 7,
        scriptPubKeyHex: '0014' + 'ab'.repeat(20),
        height: 100,
      },
    );
    assert.throws(() => parseUtxo(`${TXID}:4294967296`), /vout/);
    assert.throws(() => parseUtxo(`${TXID}:-1`), /vout/);
    assert.throws(() => parseUtxo(`${TXID}:01`), /vout/);
    assert.throws(() => parseUtxo(`${TXID}:1e3`), /vout/);
    assert.throws(() => parseUtxo(`${TXID}: 1`), /vout/);
    assert.throws(() => parseUtxo(`${TXID}:99999999999999999999`), /vout/);
    assert.throws(() => parseUtxo(`${TXID.slice(1)}:0`), /txid/);
    assert.throws(() => parseUtxo(`${'g'.repeat(64)}:0`), /txid/);
    assert.throws(() => parseUtxo(`${TXID}`), /format/);
    assert.throws(() => parseUtxo(`${TXID}:0:0014`), /format/);
    assert.throws(() => parseUtxo(`${TXID}:0:0014:1:extra`), /format/);
    assert.throws(() => parseUtxo(`${TXID}:0:00:1`), /scriptpubkey/);
    assert.throws(() => parseUtxo(`${TXID}:0:001:1`), /scriptpubkey/);
    assert.throws(() => parseUtxo(`${TXID}:0:${'00'.repeat(101)}:1`), /scriptpubkey/);
    assert.strictEqual(parseUtxo(`${TXID}:0:${'00'.repeat(100)}:1`).scriptPubKeyHex?.length, 200);
    assert.throws(() => parseUtxo(`${TXID}:0:zz14:1`), /scriptpubkey/);
    assert.throws(() => parseUtxo(`${TXID}:0:0014:-1`), /blockheight/);
    assert.throws(() => parseUtxo(`${TXID}:0:0014:2147483648`), /blockheight/);
    assert.throws(() => parseUtxo('x'.repeat(1000)));
    assert.throws(() => parseUtxo(5 as unknown as string));
  });

  it('parses, formats and bounds UTXO lists', () => {
    assert.deepStrictEqual(parseUtxoList(''), []);
    const text = `${TXID}:0, ${TXID}:5:0014${'11'.repeat(20)}:9`;
    const refs = parseUtxoList(text);
    assert.strictEqual(refs.length, 2);
    assert.strictEqual(formatUtxoList(refs, false), `${TXID}:0,${TXID}:5`);
    assert.strictEqual(formatUtxoList(refs, true), `${TXID}:0,${TXID}:5:0014${'11'.repeat(20)}:9`);
    assert.throws(() => parseUtxoList(`${TXID}:0,`));
    assert.throws(() => parseUtxoList(`${TXID}:0,${TXID}:0`), /Duplicate/);
    assert.throws(() => parseUtxoList(`${TXID}:0,,${TXID}:1`));
    assert.strictEqual(parseUtxoList(Array.from({ length: 256 }, (_, i) => `${TXID}:${i}`).join(',')).length, 256);
    assert.throws(() => parseUtxoList(new Array(257).fill(`${TXID}:0`).join(',')), /Too many/);
    assert.throws(() => parseUtxoList('1,'.repeat(200_000)));
  });

  it('verifies script binding for P2WPKH, P2PKH and P2SH-P2WPKH only', () => {
    const p = hex(podle.proofs[0].P);
    const spk = hex(podle.p2wpkh_scriptpubkey);
    assert.strictEqual(podle.binding_ok, true);
    assert.strictEqual(bindsTo(p, spk), true);

    const h160 = spk.subarray(2);
    assert.strictEqual(bindsTo(p, Buffer.concat([hex('76a914'), h160, hex('88ac')])), true);
    // P2SH-P2WPKH: OP_HASH160 <hash160(0014 <hash160(P)>)> OP_EQUAL
    const { crypto } = require('bitcoinjs-lib');
    const redeem = Buffer.concat([hex('0014'), h160]);
    assert.strictEqual(bindsTo(p, Buffer.concat([hex('a914'), Buffer.from(crypto.hash160(redeem)), hex('87')])), true);

    const wrongHash = Buffer.from(spk);
    wrongHash[10] = (wrongHash[10] + 1) % 256;
    assert.strictEqual(bindsTo(p, wrongHash), false);
    assert.strictEqual(bindsTo(hex(podle.proofs[1].P2), spk), false);
    assert.strictEqual(bindsTo(p, Buffer.concat([hex('0020'), h160, Buffer.alloc(12)])), false);
    assert.strictEqual(bindsTo(p, Buffer.concat([hex('5114'), h160])), false);
    assert.strictEqual(bindsTo(p, Buffer.concat([hex('76a914'), h160, hex('88ad')])), false);
    assert.strictEqual(bindsTo(p, Buffer.concat([hex('a914'), h160, hex('87')])), false, 'P2SH of the bare hash is not P2SH-P2WPKH');
    assert.strictEqual(bindsTo(p, Buffer.alloc(0)), false);
    assert.strictEqual(bindsTo(p.subarray(0, 32), spk), false);
    assert.strictEqual(bindsTo(Buffer.concat([Buffer.from([2]), Buffer.alloc(32, 0xff)]), spk), false);
    assert.strictEqual(bindsTo('x' as unknown as Buffer, spk), false);
  });
});
