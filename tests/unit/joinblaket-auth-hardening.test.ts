import {
  NickIdentity,
  checkDirectoryReply,
  handshakeLine,
  handshakeSha256,
  nickAuthSignedMessage,
  parseChallenge,
  proofLine,
  verifyProof,
} from '../../class/joinblaket/nick';
import { signMessage, utf8 } from '../../class/joinblaket/message-signatures';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';

const n = vectors.nick,
  h = vectors.handshake;
test('JSON-escaped duplicate authentication keys are rejected', () => {
  const text = '{"challenge":"' + h.challenge + '","chal\\u006cenge":"' + h.challenge + '","directory-id":"' + h.directory_id + '"}';
  expect(() => parseChallenge(text)).toThrow('Duplicate');
});
test('duplicate feature keys are rejected even when escaped', () => {
  const line = '{"accepted":true,"network":"xbt","features":{"nick_auth":false,"nick_\\u0061uth":true}}';
  expect(checkDirectoryReply({ type: 795, line })).not.toBeNull();
});
test('nested metadata keys do not look like duplicate top-level fields', () => {
  const line = JSON.stringify({ accepted: true, network: 'xbt', features: { nick_auth: true }, metadata: { network: 'xbt' } });
  expect(checkDirectoryReply({ type: 795, line })).toBeNull();
});
test('UTF8 bounds are enforced before creating an oversized message buffer', () => {
  expect(() => utf8('a'.repeat(65537))).toThrow('large');
});
test('ephemeral identity private bytes cannot leak through JSON or enumerable fields', () => {
  const id = new NickIdentity(Buffer.from(n.private_key, 'hex'));
  try {
    expect(Object.keys(id)).not.toContain('key');
    expect(() => JSON.stringify(id)).toThrow('serialized');
  } finally {
    id.destroy();
  }
});
test('message signatures retain exact bytes with Hermes-style plain Uint8Array slices', () => {
  const original = Buffer.prototype.subarray;
  Buffer.prototype.subarray = function (begin?: number, end?: number) {
    return Uint8Array.from(original.call(this, begin, end)) as Buffer;
  };
  try {
    expect(signMessage(Buffer.from(n.private_key, 'hex'), n.signed_data + n.hostid)).toBe(n.signature_b64);
  } finally {
    Buffer.prototype.subarray = original;
  }
});
test('directory proof signing and verification reject a handshake for the wrong network', () => {
  const id = new NickIdentity(Buffer.from(n.private_key, 'hex'));
  const challenge = { challenge: h.challenge, directoryId: h.directory_id };
  const handshake = handshakeLine(n.nick, 'btc');
  try {
    expect(() => proofLine(id, challenge, handshake, h.directory_id)).toThrow('network');
    const msg = nickAuthSignedMessage(h.challenge, h.directory_id, handshakeSha256(handshake), n.nick, n.pubkey);
    const proof = JSON.stringify({ pubkey: n.pubkey, signature: id.signBytesFor(msg) });
    expect(verifyProof(proof, challenge, h.directory_id, handshake, n.nick)).toBe(false);
  } finally {
    id.destroy();
  }
});
test('a half-specified directory protocol range cannot fall back to a compatible default', () => {
  const line = JSON.stringify({ accepted: true, network: 'xbt', 'proto-ver-min': 99, features: { nick_auth: true } });
  expect(checkDirectoryReply({ type: 795, line })).toBe('no compatible protocol version');
});
