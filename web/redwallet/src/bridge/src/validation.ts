/**
 * Strict request validation.
 *
 * The bridge accepts exactly one request shape:
 *
 *   { "method": <allowlisted bridge method>, "params": <array> }
 *
 * Anything else is rejected before any upstream contact. Addresses are
 * converted to Electrum scripthashes locally; the caller never supplies a
 * scripthash directly, so a malformed address cannot reach the upstream.
 */

import { validateSignedWebTransaction } from "./transaction.js";
import { createHash } from "node:crypto";
import { BridgeError } from "./errors.js";
import { type BridgeMethod, ALLOWLIST, isBridgeMethod } from "./allowlist.js";

export interface ValidatedRequest {
  readonly method: BridgeMethod;
  /** Params to forward upstream, already normalized. */
  readonly upstreamParams: unknown[];
}

/** Maximum number of params any allowlisted method accepts. */
const MAX_PARAMS = 2;

/** Maximum length of a single string param. */
const MAX_STRING_LEN = 256;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

/**
 * Decode an address while preserving whether it is legacy or witness.
 *
 * Supports mainnet address encodings (P2PKH version 0x00, P2SH
 * version 0x05, and bc bech32/bech32m segwit). Returns null when the input is not
 * a well-formed address. This is a format check only — it makes no claim about
 * which network an address belongs to.
 */
export type DecodedAddress =
  | { kind: "legacy"; payload: Uint8Array }
  | { kind: "witness"; payload: Uint8Array };

export function decodeAddress(address: string): DecodedAddress | null {
  if (address.length === 0 || address.length > MAX_STRING_LEN) return null;

  const lower = address.toLowerCase();
  if (lower.startsWith("bc1")) {
    const payload = decodeBech32(address);
    return payload === null ? null : { kind: "witness", payload };
  }
  const payload = decodeBase58Check(address);
  if (payload === null || (payload[0] !== 0 && payload[0] !== 5)) return null;
  return { kind: "legacy", payload };
}

const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function decodeBase58Check(input: string): Uint8Array | null {
  const bytes: number[] = [0];
  for (const char of input) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value === -1) return null;
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      const next = (bytes[i] ?? 0) * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Leading '1' characters encode leading zero bytes.
  for (let i = 0; i < input.length - 1 && input[i] === "1"; i += 1) {
    bytes.push(0);
  }
  const decoded = Uint8Array.from(bytes.reverse());
  if (decoded.length !== 25) return null;
  const payload = decoded.subarray(0, 21);
  const checksum = decoded.subarray(21);
  const expected = sha256(sha256(payload)).subarray(0, 4);
  if (!constantTimeEqual(checksum, expected)) return null;
  return payload;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function decodeBech32(input: string): Uint8Array | null {
  if (input.length > 90 || (input !== input.toLowerCase() && input !== input.toUpperCase())) return null;
  const lower = input.toLowerCase();
  const separator = lower.lastIndexOf("1");
  if (separator < 1 || separator + 7 > lower.length) return null;
  const hrp = lower.slice(0, separator);
  if (hrp !== "bc") return null;

  const data: number[] = [];
  for (const char of lower.slice(separator + 1)) {
    const value = BECH32_CHARSET.indexOf(char);
    if (value === -1) return null;
    data.push(value);
  }

  const payload = data.slice(0, -6);
  if (payload.length === 0) return null;
  const version = payload[0] ?? 0;
  if (version > 16) return null;
  const checksum = bech32Polymod([...hrpExpand(hrp), ...data]);
  if (checksum !== (version === 0 ? 1 : 0x2bc830a3)) return null;
  const program = convertBits(payload.slice(1), 5, 8, false);
  if (program === null) return null;
  if (program.length < 2 || program.length > 40) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  return Uint8Array.from([version, ...program]);
}

function hrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (const char of hrp) out.push(char.charCodeAt(0) >> 5);
  out.push(0);
  for (const char of hrp) out.push(char.charCodeAt(0) & 31);
  return out;
}

function bech32Polymod(values: number[]): number {
  const generators = [
    0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3,
  ];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if (((top >> i) & 1) === 1) {
        checksum ^= generators[i] ?? 0;
      }
    }
  }
  return checksum;
}

function convertBits(
  data: number[],
  from: number,
  to: number,
  pad: boolean,
): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    if (value < 0 || value >> from !== 0) return null;
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  if (pad) {
    if (bits > 0) out.push((acc << (to - bits)) & maxv);
  } else if (bits >= from || ((acc << (to - bits)) & maxv) !== 0) {
    return null;
  }
  return out;
}

function sha256(data: Uint8Array): Uint8Array {
  return new Uint8Array(createHash("sha256").update(data).digest());
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}

/**
 * Electrum scripthash: sha256 of the scriptPubKey, byte-reversed, hex.
 *
 * The bridge derives this from a validated address. It never accepts a
 * caller-supplied scripthash, so the upstream only ever sees a value the
 * bridge itself computed.
 */
export function addressToScripthash(address: string): string | null {
  const payload = decodeAddress(address);
  if (payload === null) return null;
  const script = scriptPubKey(payload);
  if (script === null) return null;
  const hash = sha256(script);
  return Buffer.from(hash).reverse().toString("hex");
}

export function scriptPubKey(address: DecodedAddress): Uint8Array | null {
  const payload = address.payload;
  if (address.kind === "legacy") {
    const version = payload[0] ?? 0;
    const hash = payload.subarray(1);
    if (version === 0x00) {
      // P2PKH: OP_DUP OP_HASH160 <20> OP_EQUALVERIFY OP_CHECKSIG
      return Uint8Array.from([0x76, 0xa9, 0x14, ...hash, 0x88, 0xac]);
    }
    if (version === 0x05) {
      // P2SH: OP_HASH160 <20> OP_EQUAL
      return Uint8Array.from([0xa9, 0x14, ...hash, 0x87]);
    }
    return null;
  }
  // Segwit: payload is [version, ...program].
  const version = payload[0] ?? 0;
  const program = payload.subarray(1);
  if (version === 0) {
    if (program.length === 20) {
      return Uint8Array.from([0x00, 0x14, ...program]);
    }
    if (program.length === 32) {
      return Uint8Array.from([0x00, 0x20, ...program]);
    }
    return null;
  }
  if (version >= 1 && version <= 16) {
    return Uint8Array.from([0x50 + version, program.length, ...program]);
  }
  return null;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_STRING_LEN) {
    throw new BridgeError("invalid_request");
  }
  return value;
}

/** A transaction id is exactly 64 lowercase hex characters. */
const TXID_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Validate a transaction id param.
 *
 * Rejects non-strings, empty strings, odd-length hex, non-hex characters, and
 * any length other than 64. Uppercase hex is rejected rather than normalized so
 * the caller cannot smuggle a differently-cased id past the check.
 */
export function requireTxid(value: unknown): string {
  if (typeof value !== "string" || !TXID_PATTERN.test(value)) {
    throw new BridgeError("invalid_request");
  }
  return value;
}

/**
 * Validate a raw parsed JSON body into a normalized bridge request.
 *
 * Throws `BridgeError` with a safe code on any deviation. No upstream contact
 * happens before this returns.
 */
export function validateRequest(body: unknown): ValidatedRequest {
  if (!isPlainObject(body)) throw new BridgeError("invalid_request");

  const method = body["method"];
  if (!isBridgeMethod(method)) {
    // A well-formed but unknown method is a distinct, safe error.
    if (typeof method === "string") throw new BridgeError("method_not_allowed");
    throw new BridgeError("invalid_request");
  }

  if (Object.keys(body).some(key => key !== "method" && key !== "params")) throw new BridgeError("invalid_request");
  const rawParams = body["params"];
  if (!Array.isArray(rawParams)) {
    throw new BridgeError("invalid_request");
  }
  const params: unknown[] = rawParams ?? [];
  if (params.length > MAX_PARAMS) throw new BridgeError("invalid_request");

  const spec = ALLOWLIST[method];
  switch (spec.params) {
    case "signed_transaction": {
      if (params.length !== 1) throw new BridgeError("invalid_request");
      const signed = validateSignedWebTransaction(params[0]);
      return { method, upstreamParams: [signed.hex] };
    }
    case "none": {
      if (params.length !== 0) throw new BridgeError("invalid_request");
      return { method, upstreamParams: [] };
    }
    case "scripthash": {
      if (params.length !== 1) throw new BridgeError("invalid_request");
      const address = requireString(params[0]);
      const scripthash = addressToScripthash(address);
      if (scripthash === null) throw new BridgeError("invalid_request");
      return { method, upstreamParams: [scripthash] };
    }
    case "txid": {
      if (params.length !== 1) throw new BridgeError("invalid_request");
      const txid = requireTxid(params[0]);
      // verbose=false is fixed by the bridge; the caller cannot request a
      // verbose object.
      return { method, upstreamParams: [txid, false] };
    }
    case "target_blocks": {
      if (params.length !== 1) throw new BridgeError("invalid_request");
      const target = params[0];
      if (
        typeof target !== "number" ||
        !Number.isInteger(target) ||
        target < 1 ||
        target > 1008
      ) {
        throw new BridgeError("invalid_request");
      }
      return { method, upstreamParams: [target] };
    }
    case "height": {
      if (params.length !== 1) throw new BridgeError("invalid_request");
      const height = params[0];
      if (
        typeof height !== "number" ||
        !Number.isInteger(height) ||
        height < 0 ||
        height > 100_000_000
      ) {
        throw new BridgeError("invalid_request");
      }
      return { method, upstreamParams: [height] };
    }
  }
}
