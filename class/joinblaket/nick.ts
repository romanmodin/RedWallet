// Adapted from Kilowallet rc6 core/joinblaket/Nick.kt (Apache-2.0), upstream commit 6a07be1835dc650a6274a90eb0ffeb214b5310ef.
// Nick derivation, privmsg signing/verification, directory handshake and JMP-0005 nick authentication as pure functions.
// The only key held here is a fresh per-CoinJoin ephemeral identity key; wallet keys, storage and network are not touched.
import { crypto } from 'bitcoinjs-lib';
import base from 'base-x';
import ecc from '../../blue_modules/noble_ecc';
import { randomBytes } from '../rng';
import { decodeBase64, isCompressedPoint, messageHash, signHash, utf8, verifyMessage } from './message-signatures';
import { DN_HANDSHAKE, HANDSHAKE, ONION_HOSTID, Frame, quote } from './wire';

const BASE58 = base('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz');
const NICK_RE = /^J[0-9][1-9A-HJ-NP-Za-km-zO]{14}$/;
const LOWER_HEX_64 = /^[0-9a-f]{64}$/;
const PUBKEY_HEX = /^0[23][0-9a-f]{64}$/;
const MAX_FIELD = 256;
const MAX_PRIVMSG_REST = 60_000;
export const NICK_VERSION = 5;
export const NICK_AUTH_DOMAIN = 'nick-auth-v1';

function sha256(bytes: Uint8Array): Buffer {
  return Buffer.from(crypto.sha256(bytes));
}
function wipe(bytes: Uint8Array): void {
  bytes.fill(0);
}

/** `"J<version>" + base58(sha256(ascii hex of the compressed key)[:10])`, right-padded with 'O' to 14 characters. */
export function nickFromPubkey(pubkeyHex: string, version: number = NICK_VERSION): string {
  if (typeof pubkeyHex !== 'string' || !PUBKEY_HEX.test(pubkeyHex.toLowerCase())) throw new Error('Invalid compressed public key');
  if (!Number.isInteger(version) || version < 0 || version > 9) throw new Error('Invalid nick version');
  const digest = sha256(Buffer.from(pubkeyHex.toLowerCase(), 'ascii')).subarray(0, 10);
  return 'J' + version + BASE58.encode(digest).padEnd(14, 'O');
}

export function isValidNick(nick: string): boolean {
  return typeof nick === 'string' && NICK_RE.test(nick);
}

/** `get_nick_version`: the digit after 'J', else 5. */
export function nickVersion(nick: string): number {
  return typeof nick === 'string' && nick.length >= 2 && nick[0] === 'J' && nick[1] >= '0' && nick[1] <= '9'
    ? nick.charCodeAt(1) - 48
    : NICK_VERSION;
}

export type VerifiedPrivmsg = Readonly<{
  ok: boolean;
  command: string;
  data: string;
}>;

/**
 * `verify_signed_privmsg`: [rest] is `"<command> <data...> <pubkey_hex> <sig_b64>"` (the line after `from!to!`).
 * OK only if the key hashes to [fromNick] and its strict-DER low-S signature over `data + hostid` verifies.
 * The command is never signed: callers MUST NOT treat `command` as authenticated by `ok` for any purpose other than
 * routing, and must bind everything security relevant into `data`.
 */
export function verifyPrivmsg(fromNick: string, rest: string, hostid: string = ONION_HOSTID): VerifiedPrivmsg {
  const fail = { ok: false, command: '', data: '' };
  if (typeof rest !== 'string' || typeof fromNick !== 'string' || rest.length > MAX_PRIVMSG_REST || !isValidNick(fromNick)) return fail;
  const t = rest.split(' ');
  if (t.length < 3) return fail;
  const command = t[0];
  const pubHex = t[t.length - 2];
  const data = t.slice(1, t.length - 2).join(' ');
  let ok = false;
  try {
    ok =
      PUBKEY_HEX.test(pubHex) &&
      nickFromPubkey(pubHex, nickVersion(fromNick)) === fromNick &&
      verifyMessage(data + hostid, t[t.length - 1], Buffer.from(pubHex, 'hex'));
  } catch {
    ok = false;
  }
  return { ok, command, data };
}

/** A fresh nick and the ephemeral key behind it. Call [destroy] when the CoinJoin ends; every use afterwards throws. */
export class NickIdentity {
  readonly pubkeyHex: string;
  readonly nick: string;
  private key: Uint8Array | null;

  constructor(privateKey: Uint8Array) {
    if (!(privateKey instanceof Uint8Array) || privateKey.length !== 32 || !ecc.isPrivate(privateKey))
      throw new Error('nick key out of range');
    const owned = new Uint8Array(privateKey); // own copy: destroy() must not depend on, or wipe, the caller's buffer
    const pub = ecc.pointFromScalar(owned, true);
    if (!pub) {
      wipe(owned);
      throw new Error('nick key out of range');
    }
    this.key = owned;
    Object.defineProperty(this, 'key', { enumerable: false });
    this.pubkeyHex = Buffer.from(pub).toString('hex');
    this.nick = nickFromPubkey(this.pubkeyHex);
  }

  toJSON(): never {
    throw new Error('NickIdentity must not be serialized');
  }

  /** A uniformly random identity key from class/rng.ts. */
  static async random(): Promise<NickIdentity> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const k = await randomBytes(32);
      try {
        if (ecc.isPrivate(k)) return new NickIdentity(k);
      } finally {
        wipe(k);
      }
    }
    throw new Error('Could not draw a valid nick key');
  }

  get destroyed(): boolean {
    return this.key === null;
  }

  /** Wipes the owned private key copy. Idempotent; the identity cannot sign afterwards. */
  destroy(): void {
    if (this.key) wipe(this.key);
    this.key = null;
  }

  private secret(): Uint8Array {
    if (!this.key) throw new Error('NickIdentity destroyed');
    return this.key;
  }

  /** `sign_message`: `"<data> <pubkey_hex> <sig_b64>"`, the signature covering `data + hostid` (never the command). */
  signData(data: string, hostid: string = ONION_HOSTID): string {
    const sig = this.signBytesFor(utf8(data + hostid));
    return `${data} ${this.pubkeyHex} ${sig}`;
  }

  /** The full privmsg `rest` for [command]: `"<command> <data> <pubkey_hex> <sig_b64>"`. */
  signPrivmsg(command: string, data: string, hostid: string = ONION_HOSTID): string {
    if (typeof command !== 'string' || !/^[a-z0-9_]{1,32}$/i.test(command)) throw new Error('Invalid command');
    if (typeof data !== 'string' || data.includes('\n') || data.includes('\r')) throw new Error('Invalid privmsg data');
    return `${command} ${this.signData(data, hostid)}`;
  }

  /** `sign_bytes`: base64 DER over the signed-message hash of raw [msg]. Prefer the domain-bound helpers below. */
  signBytesFor(msg: Uint8Array): string {
    return signHash(this.secret(), messageHash(msg)).toString('base64');
  }
}

export type Challenge = Readonly<{ challenge: string; directoryId: string }>;

function parseObject(line: string): Record<string, unknown> {
  if (typeof line !== 'string' || line.length > 65_536) throw new Error('Invalid JSON line');
  const value = JSON.parse(line) as unknown;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Not a JSON object');
  // JSON.parse validates syntax but discards duplicate members. Walk the already
  // validated text structurally, decoding key escapes and keeping a set at each
  // object depth. String content and nested keys never count as root keys.
  let cursor = 0,
    nodes = 0;
  const space = () => {
    while (cursor < line.length && /[ \t\r\n]/.test(line[cursor])) cursor++;
  };
  const string = (): string => {
    const start = cursor++;
    while (cursor < line.length) {
      if (line[cursor] === '\\') cursor += 2;
      else if (line[cursor++] === '"') return JSON.parse(line.slice(start, cursor));
    }
    throw new Error('Invalid JSON string');
  };
  const visit = (depth: number): void => {
    if (depth > 32 || ++nodes > 10000) throw new Error('JSON nesting or size limit');
    space();
    if (line[cursor] === '"') {
      string();
      return;
    }
    if (line[cursor] === '{') {
      cursor++;
      space();
      const seen = new Set<string>();
      if (line[cursor] !== '}')
        while (true) {
          const key = string();
          if (seen.has(key)) throw new Error('Duplicate key');
          seen.add(key);
          space();
          cursor++; // colon; JSON.parse already validated it
          visit(depth + 1);
          space();
          if (line[cursor] === '}') break;
          cursor++;
          space();
        }
      cursor++;
      return;
    }
    if (line[cursor] === '[') {
      cursor++;
      space();
      if (line[cursor] !== ']')
        while (true) {
          visit(depth + 1);
          space();
          if (line[cursor] === ']') break;
          cursor++;
        }
      cursor++;
      return;
    }
    while (cursor < line.length && !/[\s,}\]]/.test(line[cursor])) cursor++;
  };
  visit(0);
  space();
  if (cursor !== line.length) throw new Error('Invalid JSON object');
  return value as Record<string, unknown>;
}

/**
 * The `line` of the taker's HANDSHAKE frame. Keys in Python's order, features sorted and only the true ones,
 * `", "` / `": "` separators: nick auth hashes these exact bytes.
 */
export function handshakeLine(nick: string, network: string = 'xbt', nickAuth: boolean = true, neutrinoCompat: boolean = true): string {
  if (!isValidNick(nick)) throw new Error('Invalid nick');
  if (typeof network !== 'string' || !/^[a-z0-9_-]{1,32}$/.test(network)) throw new Error('Invalid network');
  const features: string[] = [];
  if (neutrinoCompat) features.push('neutrino_compat');
  if (nickAuth) features.push('nick_auth');
  features.push('peerlist_features', 'ping');
  features.sort();
  const f = features.map(name => quote(name) + ': true').join(', ');
  return (
    '{"app-name": "joinmarket", "directory": false, "location-string": "NOT-SERVING-ONION", ' +
    `"proto-ver": ${NICK_VERSION}, "features": {${f}}, "nick": ${quote(nick)}, "network": ${quote(network)}}`
  );
}

/** sha256 hex of the UTF-8 handshake line. */
export function handshakeSha256(line: string): string {
  return sha256(utf8(line)).toString('hex');
}

/**
 * Checks on the directory's DN_HANDSHAKE reply, in Python's order; returns an error message or null when acceptable.
 * Stricter than upstream: protocol versions must be real integers and `accepted` / `nick_auth` must be JSON booleans.
 */
export function checkDirectoryReply(frame: Frame, network: string = 'xbt', requireNickAuth: boolean = true): string | null {
  if (!frame || (frame.type !== HANDSHAKE && frame.type !== DN_HANDSHAKE)) return `unexpected response type ${frame && frame.type}`;
  let o: Record<string, unknown>;
  try {
    o = parseObject(frame.line);
  } catch {
    return 'handshake reply is not JSON';
  }
  if (o.accepted !== true) return 'handshake rejected';
  if (o.network !== network) return 'directory network mismatch';
  const isVer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v < 1000;
  let min: unknown = o['proto-ver'] === undefined ? NICK_VERSION : o['proto-ver'];
  let max: unknown = min;
  if ('proto-ver-min' in o !== 'proto-ver-max' in o) return 'no compatible protocol version';
  if ('proto-ver-min' in o && 'proto-ver-max' in o) {
    min = o['proto-ver-min'];
    max = o['proto-ver-max'];
  }
  if (!isVer(min) || !isVer(max) || NICK_VERSION < min || NICK_VERSION > max) return 'no compatible protocol version';
  const features = o.features;
  const nickAuth = typeof features === 'object' && features !== null && !Array.isArray(features) && (features as any).nick_auth === true;
  if (requireNickAuth && !nickAuth) return 'directory does not support required nick authentication';
  return null;
}

/** Parse the challenge line: exactly the two fields, lowercase 64-hex challenge, bounded non-empty directory id. */
export function parseChallenge(line: string): Challenge {
  const o = parseObject(line);
  const keys = Object.keys(o);
  if (keys.length !== 2 || !keys.includes('challenge') || !keys.includes('directory-id')) throw new Error('unexpected challenge fields');
  const challenge = o.challenge;
  const directoryId = o['directory-id'];
  if (typeof challenge !== 'string' || !LOWER_HEX_64.test(challenge)) throw new Error('bad challenge');
  if (typeof directoryId !== 'string' || !directoryId.length || directoryId.length > MAX_FIELD || /[^\x21-\x7b\x7d-\x7e]/.test(directoryId))
    throw new Error('bad directory id');
  return Object.freeze({ challenge, directoryId });
}

/** `build_nick_auth_signed_message`: the transcript ASCII bytes followed by `nick-auth-v1`. */
export function nickAuthSignedMessage(
  challenge: string,
  directoryId: string,
  handshakeSha: string,
  nick: string,
  pubkeyHex: string,
): Buffer {
  if (!LOWER_HEX_64.test(challenge) || !LOWER_HEX_64.test(handshakeSha)) throw new Error('bad hex field');
  if (!isValidNick(nick)) throw new Error('bad nick');
  // '|' is the transcript separator, so a directory id containing it could shift fields.
  if (typeof directoryId !== 'string' || !directoryId.length || directoryId.length > MAX_FIELD || /[^\x21-\x7b\x7d-\x7e]/.test(directoryId))
    throw new Error('bad directory id');
  if (typeof pubkeyHex !== 'string' || !/^0[23][0-9a-f]{64}$/.test(pubkeyHex)) throw new Error('bad pubkey');
  return Buffer.from(`nick-auth|${challenge}|${directoryId}|${handshakeSha}|${nick}|${pubkeyHex}${NICK_AUTH_DOMAIN}`, 'ascii');
}

/**
 * The NICK_AUTH_PROOF line, compact JSON `{"pubkey":"..","signature":".."}`. [expectedDirectoryId] is the directory id the
 * caller configured; a challenge naming any other directory (or a nick other than the identity's own handshake nick) is rejected,
 * so a hostile directory cannot get a signature that is valid for a different one.
 */
export function proofLine(
  identity: NickIdentity,
  challenge: Challenge,
  handshake: string,
  expectedDirectoryId: string,
  expectedNetwork = 'xbt',
): string {
  if (challenge.directoryId !== expectedDirectoryId) throw new Error('directory id mismatch');
  let parsed: Record<string, unknown>;
  try {
    parsed = parseObject(handshake);
  } catch {
    throw new Error('handshake is not JSON');
  }
  if (parsed.nick !== identity.nick) throw new Error('handshake nick mismatch');
  if (parsed.network !== expectedNetwork) throw new Error('handshake network mismatch');
  const msg = nickAuthSignedMessage(
    challenge.challenge,
    challenge.directoryId,
    handshakeSha256(handshake),
    identity.nick,
    identity.pubkeyHex,
  );
  return `{"pubkey":${quote(identity.pubkeyHex)},"signature":${quote(identity.signBytesFor(msg))}}`;
}

/** True only for `{"code":"ok","verified":true}` (JSON boolean, nothing ambiguous). */
export function resultOk(line: string): boolean {
  try {
    const o = parseObject(line);
    return o.code === 'ok' && o.verified === true;
  } catch {
    return false;
  }
}

/** Verifies a nick-auth proof the way a directory would; used to check our own output and in tests. */
export function verifyProof(
  proofJson: string,
  challenge: Challenge,
  expectedDirectoryId: string,
  handshake: string,
  nick: string,
  expectedNetwork = 'xbt',
): boolean {
  try {
    if (challenge.directoryId !== expectedDirectoryId) return false;
    const hello = parseObject(handshake);
    if (hello.nick !== nick || hello.network !== expectedNetwork) return false;
    const o = parseObject(proofJson);
    const pub = o.pubkey;
    const sig = o.signature;
    if (typeof pub !== 'string' || typeof sig !== 'string' || nickFromPubkey(pub, nickVersion(nick)) !== nick) return false;
    const pubBytes = Buffer.from(pub, 'hex');
    if (!isCompressedPoint(pubBytes) || decodeBase64(sig) === null) return false;
    return verifyMessage(
      nickAuthSignedMessage(challenge.challenge, challenge.directoryId, handshakeSha256(handshake), nick, pub),
      sig,
      pubBytes,
    );
  } catch {
    return false;
  }
}
