import assert from 'assert';

import { Box, generateSecret, hsalsa20, publicKey, secretboxOpen, secretboxSeal } from '../../class/joinblaket/nacl';

const kat: Array<{
  sk_a: string;
  pk_a: string;
  sk_b: string;
  pk_b: string;
  x25519: string;
  shared: string;
  nonce: string;
  msg: string;
  box: string;
}> = require('../fixtures/joinblaket/nacl-kat.json');
const vectors = require('../fixtures/joinblaket/xbt-taker-vectors.json');

const hex = (s: string): Buffer => Buffer.from(s, 'hex');

describe('JoinBlaket NaCl crypto_box', () => {
  it('matches the libsodium known answers (public keys, shared key, secretbox)', () => {
    assert.ok(kat.length >= 16);
    for (const v of kat) {
      assert.strictEqual(publicKey(hex(v.sk_a)).toString('hex'), v.pk_a);
      assert.strictEqual(publicKey(hex(v.sk_b)).toString('hex'), v.pk_b);

      const a = new Box(hex(v.sk_a), hex(v.pk_b));
      const b = new Box(hex(v.sk_b), hex(v.pk_a));
      assert.strictEqual(hsalsa20(hex(v.x25519), Buffer.alloc(16)).toString('hex'), v.shared);

      const sealed = secretboxSeal(hex(v.shared), hex(v.nonce), hex(v.msg));
      assert.strictEqual(sealed.toString('hex'), v.box);
      assert.strictEqual(a.seal(hex(v.msg), hex(v.nonce)).toString('hex'), v.nonce + v.box);
      assert.strictEqual(secretboxOpen(hex(v.shared), hex(v.nonce), sealed)?.toString('hex'), v.msg);

      const wire = a.seal(hex(v.msg), hex(v.nonce)).toString('base64');
      assert.strictEqual(b.decrypt(wire).toString('hex'), v.msg);
      a.destroy();
      b.destroy();
    }
  });

  it('HSalsa20 over the X25519 output gives the shared key', () => {
    const v = kat[0];
    assert.strictEqual(hsalsa20(hex(v.x25519), Buffer.alloc(16)).toString('hex'), v.shared);
    assert.throws(() => hsalsa20(Buffer.alloc(31), Buffer.alloc(16)));
    assert.throws(() => hsalsa20(Buffer.alloc(32), Buffer.alloc(15)));
  });

  it('reproduces the taker/maker wire vectors byte for byte', async () => {
    const e = vectors.encryption;
    assert.strictEqual(publicKey(hex(e.taker_private)).toString('hex'), e.taker_public);
    assert.strictEqual(publicKey(hex(e.maker_private)).toString('hex'), e.maker_public);
    const taker = new Box(hex(e.taker_private), hex(e.maker_public));
    const maker = new Box(hex(e.maker_private), hex(e.taker_public));
    assert.strictEqual(e.shared_key, e.shared_key_maker_side);

    const wire = taker.seal(Buffer.from(e.plaintext), hex(e.nonce)).toString('base64');
    assert.strictEqual(wire, e.wire_b64);
    assert.strictEqual(maker.decryptString(e.wire_b64), e.decrypted_by_maker);
    assert.strictEqual(maker.seal(Buffer.from(e.reply_plaintext), hex(e.reply_nonce)).toString('base64'), e.reply_wire_b64);
    assert.strictEqual(taker.decryptString(e.reply_wire_b64), e.reply_plaintext);
  });

  it('uses a fresh CSPRNG nonce per message', async () => {
    const e = vectors.encryption;
    const taker = new Box(hex(e.taker_private), hex(e.maker_public));
    const maker = new Box(hex(e.maker_private), hex(e.taker_public));
    const a = await taker.encrypt('same plaintext');
    const b = await taker.encrypt('same plaintext');
    assert.notStrictEqual(a, b);
    assert.notStrictEqual(
      Buffer.from(a, 'base64').subarray(0, 24).toString('hex'),
      Buffer.from(b, 'base64').subarray(0, 24).toString('hex'),
    );
    assert.strictEqual(maker.decryptString(a), 'same plaintext');
    assert.strictEqual(maker.decryptString(b), 'same plaintext');
    const secret = await generateSecret();
    assert.strictEqual(secret.length, 32);
  });

  it('rejects all-zero (low-order) Diffie-Hellman results', () => {
    const e = vectors.encryption;
    const lowOrder = [
      Buffer.alloc(32), // u = 0
      Buffer.from('0100000000000000000000000000000000000000000000000000000000000000', 'hex'), // u = 1
      Buffer.from('e0eb7a7c3b41b8ae1656e3faf19fc46ada098deb9c32b1fd866205165f49b800', 'hex'), // order 8
      Buffer.from('5f9c95bca3508c24b1d0b1559c83ef5b04445cc4581c8e86d8224eddd09f1157', 'hex'), // order 8
    ];
    for (const pk of lowOrder) assert.throws(() => new Box(hex(e.taker_private), pk));
  });

  it('rejects wrong key and nonce sizes', () => {
    const e = vectors.encryption;
    assert.throws(() => new Box(Buffer.alloc(31), hex(e.maker_public)));
    assert.throws(() => new Box(hex(e.taker_private), Buffer.alloc(33)));
    assert.throws(() => publicKey(Buffer.alloc(33)));
    const box = new Box(hex(e.taker_private), hex(e.maker_public));
    assert.throws(() => box.seal(Buffer.from('x'), Buffer.alloc(23)));
    assert.strictEqual(secretboxOpen(Buffer.alloc(32), Buffer.alloc(23), Buffer.alloc(32)), null);
    assert.strictEqual(secretboxOpen(Buffer.alloc(32), Buffer.alloc(24), Buffer.alloc(15)), null);
  });

  it('rejects a bad MAC, tampered ciphertext, truncation and a wrong key', () => {
    const e = vectors.encryption;
    const maker = new Box(hex(e.maker_private), hex(e.taker_public));
    const raw = Buffer.from(e.wire_b64, 'base64');
    for (const index of [0, 23, 24, 39, 40, raw.length - 1]) {
      const bad = Buffer.from(raw);
      bad[index] = (bad[index] + 1) % 256;
      assert.throws(() => maker.decrypt(bad.toString('base64')), /authentication failed/);
    }
    assert.throws(() => maker.decrypt(raw.subarray(0, raw.length - 1).toString('base64')), /authentication failed/);
    assert.throws(() => maker.decrypt(raw.subarray(0, 39).toString('base64')), /too short/);
    const stranger = new Box(hex(kat[0].sk_a), hex(kat[0].pk_b));
    assert.throws(() => stranger.decrypt(e.wire_b64), /authentication failed/);
  });

  it('rejects noncanonical, oversized and malformed base64', () => {
    const e = vectors.encryption;
    const maker = new Box(hex(e.maker_private), hex(e.taker_public));
    const wire: string = e.wire_b64;
    assert.strictEqual(maker.decryptString(wire), e.plaintext);
    assert.throws(() => maker.decrypt(wire + '\n'), /base64/);
    assert.throws(() => maker.decrypt(' ' + wire), /base64/);
    assert.throws(() => maker.decrypt(wire.slice(0, 4) + '\n' + wire.slice(4)), /base64/);
    assert.throws(() => maker.decrypt(wire.replace(/\+/g, '-').replace(/\//g, '_')), /base64/);
    assert.throws(() => maker.decrypt(''), /base64/);
    assert.throws(() => maker.decrypt('A'.repeat(64057)), /base64/);
    assert.throws(() => maker.decrypt(4 as unknown as string), /base64/);
    // Non-zero trailing bits in the final quantum are noncanonical.
    const padded = Buffer.from([1, 2, 3, 4, 5]).toString('base64');
    assert.strictEqual(padded, 'AQIDBAU=');
    assert.throws(() => maker.decrypt('AQIDBAV='), /base64/);
  });

  it('rejects invalid UTF-8 plaintext and lone surrogates', async () => {
    const e = vectors.encryption;
    const taker = new Box(hex(e.taker_private), hex(e.maker_public));
    const maker = new Box(hex(e.maker_private), hex(e.taker_public));
    const nonce = hex(e.nonce);
    const invalid = [Buffer.from([0xff]), Buffer.from([0xc3, 0x28]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xed, 0xa0, 0x80])];
    for (const bytes of invalid) {
      const wire = taker.seal(bytes, nonce).toString('base64');
      assert.strictEqual(maker.decrypt(wire).toString('hex'), bytes.toString('hex'));
      assert.throws(() => maker.decryptString(wire), /UTF-8/);
    }
    await assert.rejects(taker.encrypt('\ud800'));
    await assert.rejects(taker.encrypt('a\udc00b'));
    const ok = await taker.encrypt('h\u00e9llo \u20bf \ud83d\ude00');
    assert.strictEqual(maker.decryptString(ok), 'h\u00e9llo \u20bf \ud83d\ude00');
  });

  it('wipes key material on destroy and does not serialize secrets', () => {
    const e = vectors.encryption;
    const box = new Box(hex(e.taker_private), hex(e.maker_public));
    assert.throws(() => JSON.stringify(box), /serialized/);
    assert.deepStrictEqual(Object.keys(box), []);
    box.destroy();
    box.destroy();
    assert.throws(() => box.seal(Buffer.from('x'), hex(e.nonce)), /destroyed/);
    assert.throws(() => box.decrypt(e.wire_b64), /destroyed/);
  });

  it('never mutates or retains the caller secret and public key buffers', () => {
    const e = vectors.encryption;
    const secret = hex(e.taker_private);
    const pub = hex(e.maker_public);
    const box = new Box(secret, pub);
    assert.strictEqual(secret.toString('hex'), e.taker_private);
    assert.strictEqual(pub.toString('hex'), e.maker_public);
    box.destroy();
    assert.strictEqual(secret.toString('hex'), e.taker_private);
  });

  it('accepts plain Uint8Array and sliced views (Hermes Buffer.subarray) as inputs', () => {
    const e = vectors.encryption;
    const backing = Buffer.concat([Buffer.from([0xaa, 0xbb, 0xcc]), hex(e.taker_private), hex(e.maker_public)]);
    const secretView = new Uint8Array(backing.buffer, backing.byteOffset + 3, 32);
    const publicView = new Uint8Array(backing.buffer, backing.byteOffset + 35, 32);
    const box = new Box(secretView, publicView);
    assert.strictEqual(box.seal(Buffer.from(e.plaintext), hex(e.nonce)).toString('base64'), e.wire_b64);
    const wire = Buffer.from(e.wire_b64, 'base64');
    const plainView = new Uint8Array(wire);
    assert.ok(!Buffer.isBuffer(plainView));
    assert.strictEqual(
      new Box(hex(e.maker_private), hex(e.taker_public)).decryptString(Buffer.from(plainView).toString('base64')),
      e.plaintext,
    );
  });
});
