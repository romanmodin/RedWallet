// Adapted from Kilowallet rc6 core/joinblaket/Wire.kt (Apache-2.0), upstream commit 6a07be1835dc650a6274a90eb0ffeb214b5310ef.
// Pure framing only: no network, sockets, keys, signing or broadcast.

export const PRIVMSG = 685;
export const PUBMSG = 687;
export const PEERLIST = 789;
export const GETPEERLIST = 791;
export const HANDSHAKE = 793;
export const DN_HANDSHAKE = 795;
export const PING = 798;
export const PONG = 799;
export const NICK_AUTH_CHALLENGE = 803;
export const NICK_AUTH_PROOF = 805;
export const NICK_AUTH_RESULT = 807;

/** The fixed hostid every privmsg signature covers, whatever channel carries it. */
export const ONION_HOSTID = 'onion-network';

/** Upper bound for one received frame (including its line terminator), in UTF-16 code units. */
export const MAX_FRAME_LENGTH = 65_536;

export type Frame = Readonly<{ type: number; line: string }>;

const KNOWN_TYPES: ReadonlySet<number> = new Set([
  PRIVMSG,
  PUBMSG,
  PEERLIST,
  GETPEERLIST,
  HANDSHAKE,
  DN_HANDSHAKE,
  PING,
  PONG,
  NICK_AUTH_CHALLENGE,
  NICK_AUTH_PROOF,
  NICK_AUTH_RESULT,
]);

/** True for the message type constants this module knows about. Parsing itself accepts any integer type. */
export function isKnownType(type: number): boolean {
  return KNOWN_TYPES.has(type);
}

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      if (next < 0xdc00 || next > 0xdfff) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * A JSON string literal exactly as Python's `json.dumps` (ensure_ascii) writes it: the short escapes for
 * `"` `\` `\n` `\r` `\t` `\b` `\f`, `\uXXXX` (lowercase hex) for every other control or non-ASCII UTF-16 code unit
 * (astral characters therefore become surrogate pairs), and DEL (0x7f) as `\u007f`.
 * Lone surrogates are rejected: they cannot be encoded as UTF-8 for the wire.
 */
export function quote(text: string): string {
  if (typeof text !== 'string') throw new Error('Wire string expected');
  if (hasLoneSurrogate(text)) throw new Error('Lone surrogate in wire string');
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const code = text.charCodeAt(i);
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (code < 0x20 || code > 0x7e) out += '\\u' + code.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

function checkType(type: number): void {
  if (!Number.isSafeInteger(type) || type < 0) throw new Error('Invalid frame type');
}

/**
 * A frame as Python's `json.dumps({"type": t, "line": l})` writes it (`", "` / `": "` separators, non-ASCII escaped),
 * without the trailing `\r\n`. Only the HANDSHAKE needs these exact bytes, but matching them keeps the vectors byte-equal.
 */
export function envelope(type: number, line: string): string {
  checkType(type);
  return '{"type": ' + type + ', "line": ' + quote(line) + '}';
}

/** `envelope` plus the `\r\n` terminator: the exact text written to the channel for one frame. */
export function encodeFrame(type: number, line: string): string {
  const text = envelope(type, line) + '\r\n';
  if (text.length > MAX_FRAME_LENGTH) throw new Error('Frame is too large');
  return text;
}

// JSON.parse silently keeps the last of duplicate keys and maps 1.0 / 1e3 to integers. The text is already known to be
// valid JSON here, so walk the top-level object once and return each key with the raw text of its value.
function topLevelMembers(json: string): Array<[string, string]> {
  const members: Array<[string, string]> = [];
  const skipSpace = (from: number): number => {
    let k = from;
    while (k < json.length && /[ \t\r\n]/.test(json[k])) k++;
    return k;
  };
  const stringEnd = (from: number): number => {
    let k = from + 1;
    while (json[k] !== '"') k += json[k] === '\\' ? 2 : 1;
    return k + 1;
  };
  let i = skipSpace(1);
  while (json[i] !== '}') {
    const keyEnd = stringEnd(i);
    const key = JSON.parse(json.slice(i, keyEnd)) as string;
    i = skipSpace(skipSpace(keyEnd) + 1);
    const start = i;
    if (json[i] === '"') i = stringEnd(i);
    else {
      let depth = 0;
      while (i < json.length && (depth > 0 || (json[i] !== ',' && json[i] !== '}'))) {
        if (json[i] === '"') i = stringEnd(i);
        else {
          if (json[i] === '{' || json[i] === '[') depth++;
          else if (json[i] === '}' || json[i] === ']') depth--;
          i++;
        }
      }
    }
    members.push([key, json.slice(start, i).trim()]);
    i = skipSpace(i);
    if (json[i] === ',') i = skipSpace(i + 1);
  }
  return members;
}

/** Parse one received line (one trailing `\r\n`, `\n` or `\r` allowed); throws on anything that is not a strict frame. */
export function parse(text: string): Frame {
  if (typeof text !== 'string' || text.length > MAX_FRAME_LENGTH) throw new Error('Invalid frame size');
  const body = text.replace(/(?:\r\n|\n|\r)$/, '');
  if (!body.length || /[\r\n]/.test(body)) throw new Error('Invalid frame line termination');
  if (hasLoneSurrogate(body)) throw new Error('Lone surrogate in frame');
  if (!body.startsWith('{') || !body.endsWith('}')) throw new Error('Frame is not a JSON object');
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error('Frame is not valid JSON');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Frame is not a JSON object');
  const members = topLevelMembers(body);
  const names = members.map(m => m[0]);
  if (names.length !== 2 || !names.includes('type') || !names.includes('line') || new Set(names).size !== 2)
    throw new Error('Frame must contain exactly one "type" and one "line"');
  const { type, line } = value as Record<string, unknown>;
  const rawType = members.find(m => m[0] === 'type')?.[1] ?? '';
  // Canonical non-negative integer text only: no sign, fraction, exponent or leading zero.
  if (typeof type !== 'number' || !/^(?:0|[1-9][0-9]*)$/.test(rawType) || !Number.isSafeInteger(type))
    throw new Error('Frame type must be an integer');
  if (typeof line !== 'string') throw new Error('Frame line must be a string');
  return Object.freeze({ type, line });
}
