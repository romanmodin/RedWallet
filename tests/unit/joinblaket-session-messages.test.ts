import { Box } from '../../class/joinblaket/nacl';
import { NickIdentity } from '../../class/joinblaket/nick';
import {
  incoming,
  fillData,
  privateMessage,
  parseMakerPubkey,
  decodeIoauth,
  decodeMakerSignature,
} from '../../class/joinblaket/session-messages';
import { parse } from '../../class/joinblaket/wire';
import vectors from '../fixtures/joinblaket/xbt-taker-vectors.json';
const s = vectors.session,
  e = vectors.encryption;
const box = () => new Box(Buffer.from(e.taker_private, 'hex'), Buffer.from(e.maker_public, 'hex'));
const makerBox = () => new Box(Buffer.from(e.maker_private, 'hex'), Buffer.from(e.taker_public, 'hex'));
test('fill encoding and signed private frame match the pinned vector', () => {
  const id = new NickIdentity(Buffer.from(vectors.nick.private_key, 'hex'));
  try {
    const data = fillData(0, 30000000, e.taker_public, vectors.podle.proofs[0].commitment_wire);
    expect(data).toBe(s.fill.data);
    expect(privateMessage(id, s.maker_nick, 'fill', data)).toBe(s.fill.frame);
  } finally {
    id.destroy();
  }
});
test('only verified messages addressed to us from expected makers enter the expected state', () => {
  const makers = new Set([s.maker_nick]),
    frame = parse(s.ioauth.frame);
  expect(incoming(frame, s.taker_nick, makers, 'ioauth')?.data).toBe(s.ioauth.ciphertext);
  expect(incoming(frame, s.maker_nick, makers, 'ioauth')).toBeNull();
  expect(incoming(frame, s.taker_nick, new Set(), 'ioauth')).toBeNull();
  expect(incoming(frame, s.taker_nick, makers, 'sig')).toBeNull();
  expect(incoming({ ...frame, line: frame.line.replace(s.ioauth.ciphertext, 'AAAA') }, s.taker_nick, makers, 'ioauth')).toBeNull();
});
test('pubkey/features and ioauth plaintext decode exactly with strict extra-field rejection', () => {
  expect(parseMakerPubkey(s.pubkey.data)).toEqual({ publicKey: e.maker_public, features: ['neutrino_compat'] });
  const receiver = box(),
    sender = makerBox();
  try {
    const io = decodeIoauth(receiver, s.ioauth.ciphertext);
    expect(io.authPub).toBe(s.ioauth.auth_pub);
    expect(io.signature).toBe(s.ioauth.btc_sig);
    expect(io.utxos).toHaveLength(2);
    expect(Object.isFrozen(io.utxos[0])).toBe(true);
    for (const text of [s.ioauth.plaintext + ' extra', '', s.ioauth.plaintext.replace(s.ioauth.utxo_list, '')]) {
      const encrypted = sender.seal(Buffer.from(text), Buffer.alloc(24)).toString('base64');
      expect(() => decodeIoauth(receiver, encrypted)).toThrow();
    }
  } finally {
    receiver.destroy();
    sender.destroy();
  }
});
test('encrypted signatures match every pinned maker witness and reject trailing bytes or wrong sighash', () => {
  const receiver = box(),
    sender = makerBox();
  try {
    for (const [i, sig] of s.sig.entries()) {
      expect(decodeMakerSignature(receiver, sig.ciphertext)).toEqual({
        signature: vectors.transaction.inputs[i + 1].signature,
        publicKey: vectors.transaction.inputs[i + 1].pubkey,
      });
    }
    const raw = Buffer.from(s.sig[0].plaintext, 'base64');
    const wrong = Buffer.from(raw);
    wrong[wrong[0]] = 1;
    for (const bytes of [Buffer.concat([raw, Buffer.from([0])]), wrong, Buffer.from([255]), raw.subarray(0, -1)]) {
      const ciphertext = sender.seal(Buffer.from(bytes.toString('base64')), Buffer.alloc(24)).toString('base64');
      expect(() => decodeMakerSignature(receiver, ciphertext)).toThrow();
    }
  } finally {
    receiver.destroy();
    sender.destroy();
  }
});
test('malformed keys, features, fill data and recipients are rejected before sending', () => {
  for (const text of [
    '00'.repeat(32),
    'aa',
    e.maker_public + ' features=a,a',
    e.maker_public + ' features=a extra',
    e.maker_public + ' features=' + 'x'.repeat(65),
  ])
    expect(() => parseMakerPubkey(text)).toThrow();
  expect(() => fillData(-1, 30000, e.taker_public, vectors.podle.proofs[0].commitment_wire)).toThrow();
  expect(() => fillData(0, 0, e.taker_public, vectors.podle.proofs[0].commitment_wire)).toThrow();
  const id = new NickIdentity(Buffer.from(vectors.nick.private_key, 'hex'));
  try {
    expect(() => privateMessage(id, 'bad!recipient', 'fill', s.fill.data)).toThrow();
  } finally {
    id.destroy();
  }
});
