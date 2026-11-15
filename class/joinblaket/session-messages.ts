// Adapted from pinned rc6 Session.kt. These codecs do not authorize a payment.
import { Box } from './nacl';
import { Frame, PRIVMSG, envelope } from './wire';
import { NickIdentity, isValidNick, verifyPrivmsg } from './nick';
import { decodeBase64, isCompressedPoint, parseStrictDer } from './message-signatures';
import { UtxoRef, parseUtxoList } from './podle';
import { sats } from './fees';

const COMMANDS = ['fill', 'pubkey', 'auth', 'ioauth', 'tx', 'sig', 'push', 'error'] as const;
export type SessionCommand = (typeof COMMANDS)[number];
export type Incoming = Readonly<{ from: string; to: string; command: SessionCommand; data: string }>;
export function privateMessage(id: NickIdentity, to: string, command: SessionCommand, data: string): string {
  if (!isValidNick(to) || !COMMANDS.includes(command)) throw new Error('Invalid session recipient or command');
  return envelope(PRIVMSG, id.nick + '!' + to + '!' + id.signPrivmsg(command, data));
}
// The protocol signs data, not the command. The caller MUST supply the command
// allowed by its current state; it must never dispatch arbitrary signed commands.
export function incoming(
  frame: Frame,
  ourNick: string,
  expectedMakers: ReadonlySet<string>,
  expectedCommand: SessionCommand,
): Incoming | null {
  if (!isValidNick(ourNick) || !COMMANDS.includes(expectedCommand)) throw new Error('Invalid session context');
  if (
    frame.type !== PRIVMSG ||
    typeof frame.line !== 'string' ||
    frame.line.length > 65536 ||
    Buffer.byteLength(frame.line, 'utf8') > 65536
  )
    return null;
  const first = frame.line.indexOf('!'),
    second = frame.line.indexOf('!', first + 1);
  if (first < 0 || second < 0) return null;
  const from = frame.line.slice(0, first),
    to = frame.line.slice(first + 1, second);
  if (to !== ourNick || !expectedMakers.has(from) || !isValidNick(from)) return null;
  const result = verifyPrivmsg(from, frame.line.slice(second + 1));
  return result.ok && result.command === expectedCommand ? Object.freeze({ from, to, command: expectedCommand, data: result.data }) : null;
}
export function fillData(oid: number, amount: number, publicKey: string, commitment: string): string {
  if (
    !Number.isSafeInteger(oid) ||
    oid < 0 ||
    sats(amount) === 0 ||
    !/^[0-9a-f]{64}$/.test(publicKey) ||
    !/^P[0-9a-f]{64}$/.test(commitment)
  )
    throw new Error('Invalid fill data');
  return oid + ' ' + amount + ' ' + publicKey + ' ' + commitment;
}
export function parseMakerPubkey(data: string): Readonly<{ publicKey: string; features: readonly string[] }> {
  if (typeof data !== 'string' || data.length > 4096) throw new Error('Invalid maker key message');
  const parts = data.trim().split(/\s+/);
  if (parts.length < 1 || parts.length > 2 || !/^[0-9a-fA-F]{64}$/.test(parts[0]) || /^0{64}$/.test(parts[0]))
    throw new Error('Invalid maker NaCl key');
  if (parts.length === 2 && !parts[1].startsWith('features=')) throw new Error('Invalid maker features');
  const features = parts.length === 2 ? parts[1].slice(9).split(',').filter(Boolean) : [];
  if (features.length > 64 || features.some(x => !/^[a-zA-Z0-9_-]{1,64}$/.test(x)) || new Set(features).size !== features.length)
    throw new Error('Invalid maker features');
  return Object.freeze({ publicKey: parts[0].toLowerCase(), features: Object.freeze(features) });
}
export type IoAuth = Readonly<{
  utxos: readonly UtxoRef[];
  authPub: string;
  paymentAddress: string;
  changeAddress: string;
  signature: string;
}>;
export function decodeIoauth(box: Box, ciphertext: string): IoAuth {
  const parts = box.decryptString(ciphertext).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('ioauth needs exactly five fields');
  const utxos = parseUtxoList(parts[0]);
  if (
    utxos.length < 1 ||
    utxos.length > 15 ||
    !/^0[23][0-9a-fA-F]{64}$/.test(parts[1]) ||
    parts[2].length > 90 ||
    parts[3].length > 90 ||
    parts[4].length > 100
  )
    throw new Error('Invalid ioauth');
  return Object.freeze({
    utxos: Object.freeze(utxos),
    authPub: parts[1].toLowerCase(),
    paymentAddress: parts[2],
    changeAddress: parts[3],
    signature: parts[4],
  });
}
export function decodeMakerSignature(box: Box, ciphertext: string): Readonly<{ signature: string; publicKey: string }> {
  const plain = box.decryptString(ciphertext);
  if (plain.length > 148) throw new Error('Oversized maker signature');
  const raw = decodeBase64(plain);
  if (!raw || raw.length < 2) throw new Error('Invalid signature encoding');
  const sl = raw[0],
    pl = raw[1 + sl];
  if (sl < 9 || sl > 73 || pl !== 33 || raw.length !== 2 + sl + pl) throw new Error('Invalid signature layout');
  const signature = Buffer.from(raw.subarray(1, 1 + sl)),
    publicKey = Buffer.from(raw.subarray(2 + sl));
  if (signature[signature.length - 1] !== 0x21 || !parseStrictDer(signature.subarray(0, -1)) || !isCompressedPoint(publicKey))
    throw new Error('Invalid maker signature or key');
  // Actual signature verification requires the immutable reviewed transaction.
  return Object.freeze({ signature: signature.toString('hex'), publicKey: publicKey.toString('hex') });
}
