import { Box } from '../../class/joinblaket/nacl';
import { bindsTo, nonceHash, rfc6979Nonce, verify } from '../../class/joinblaket/podle';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';
const hex = (s: string) => Buffer.from(s, 'hex'),
  e = vectors.encryption,
  p = vectors.podle;
const pair = () => [new Box(hex(e.taker_private), hex(e.maker_public)), new Box(hex(e.maker_private), hex(e.taker_public))] as const;

test('normal-size encrypted transaction messages can exceed 4096 base64 characters', async () => {
  const [sender, receiver] = pair();
  try {
    const plain = 'ab'.repeat(10000);
    expect(receiver.decryptString(await sender.encrypt(plain))).toBe(plain);
  } finally {
    sender.destroy();
    receiver.destroy();
  }
});
test('session keys do not leak through enumerable properties, object copies or JSON', () => {
  const [sender, receiver] = pair();
  try {
    expect(Object.values(sender).some(v => v instanceof Uint8Array)).toBe(false);
    expect(JSON.stringify({ ...sender })).not.toContain('"data":');
    expect(() => JSON.stringify(sender)).toThrow('serialized');
  } finally {
    sender.destroy();
    receiver.destroy();
  }
});
test('encryption snapshots input before awaiting entropy', async () => {
  const [sender, receiver] = pair();
  try {
    const plain = Buffer.from('approved message'),
      pending = sender.encrypt(plain);
    plain.fill(0);
    expect(receiver.decryptString(await pending)).toBe('approved message');
  } finally {
    sender.destroy();
    receiver.destroy();
  }
});
test('PoDLE script binding works with Hermes-style Uint8Array slices', () => {
  const original = Buffer.prototype.subarray;
  Buffer.prototype.subarray = function (begin?: number, end?: number) {
    return Uint8Array.from(original.call(this, begin, end)) as Buffer;
  };
  try {
    expect(bindsTo(hex(p.proofs[0].P), hex(p.p2wpkh_scriptpubkey))).toBe(true);
  } finally {
    Buffer.prototype.subarray = original;
  }
});
test('nonce helpers reject invalid keys and NUMS indices instead of coercing', () => {
  expect(() => rfc6979Nonce(Buffer.alloc(32), Buffer.alloc(32))).toThrow();
  expect(() => nonceHash(p.utxo, 256, hex(p.proofs[0].P), hex(p.proofs[0].P2))).toThrow();
});
test('all requested PoDLE verification indices are validated before accepting a proof', () => {
  const v = p.proofs[0];
  expect(verify(hex(v.P), hex(v.P2), hex(v.s), hex(v.e), hex(v.commitment), [v.index, 256])).toBe(false);
});
