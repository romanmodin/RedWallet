/** Structural guard for the reviewed web signer's narrow transaction format.
 * Not connected to an RPC route yet. Consensus/signature validation belongs to
 * the XBT node; passing this parser alone never means a transaction is valid.
 */
import { createHash } from "node:crypto";
import { BridgeError } from "./errors.js";

const MAX_MONEY = 2_100_000_000_000_000n;
function invalid(): never { throw new BridgeError("invalid_request"); }

export function validateSignedWebTransaction(value: unknown): { hex: string; txid: string } {
  if (typeof value !== "string" || value.length > 200_000 || !/^(?:[0-9a-f]{2})+$/.test(value)) invalid();
  const bytes = Buffer.from(value, "hex");
  let position = 0;
  const read = (length: number): Buffer => {
    if (position + length > bytes.length) invalid();
    const result = bytes.subarray(position, position + length);
    position += length;
    return result;
  };
  // Every supported count and script/witness length is below 253. Refusing
  // extended encodings also rejects noncanonical CompactSize values.
  const smallSize = (): number => { const n = read(1)[0]!; if (n >= 253) invalid(); return n; };
  const version = read(4);
  if (version.readInt32LE() !== 2 || !read(2).equals(Buffer.from([0, 1]))) invalid();
  const bodyStart = position;
  const count = smallSize();
  if (count < 1 || count > 100) invalid();
  const outpoints = new Set<string>();
  for (let i = 0; i < count; i++) {
    const hash = read(32);
    const index = read(4).readUInt32LE();
    if (hash.every(byte => byte === 0) || index === 0xffffffff) invalid();
    const outpoint = `${hash.toString("hex")}:${index}`;
    if (outpoints.has(outpoint)) invalid();
    outpoints.add(outpoint);
    if (smallSize() !== 0 || read(4).readUInt32LE() !== 0xfffffffd) invalid();
  }
  const outputs = smallSize();
  if (outputs < 1 || outputs > 2) invalid();
  let total = 0n;
  for (let i = 0; i < outputs; i++) {
    const amount = read(8).readBigUInt64LE();
    total += amount;
    if (amount < 294n || amount > MAX_MONEY || total > MAX_MONEY || smallSize() !== 22) invalid();
    const script = read(22);
    if (script[0] !== 0 || script[1] !== 20) invalid();
  }
  const bodyEnd = position;
  for (let i = 0; i < count; i++) {
    if (smallSize() !== 2) invalid();
    const signature = read(smallSize());
    if (signature.length < 9 || signature.length > 73 || signature.at(-1) !== 0x21) invalid();
    // Strict DER integer framing (BIP66) plus native XBT Unified SIGHASH_ALL.
    if (signature[0] !== 0x30 || signature[1] !== signature.length - 3 || signature[2] !== 2) invalid();
    const rLength = signature[3]!;
    if (rLength < 1 || rLength > 33 || 5 + rLength >= signature.length || signature[4]! & 0x80) invalid();
    if (rLength > 1 && signature[4] === 0 && !(signature[5]! & 0x80)) invalid();
    if (signature[4 + rLength] !== 2) invalid();
    const sLength = signature[5 + rLength]!;
    if (sLength < 1 || sLength > 33 || rLength + sLength + 7 !== signature.length || signature[6 + rLength]! & 0x80) invalid();
    if (sLength > 1 && signature[6 + rLength] === 0 && !(signature[7 + rLength]! & 0x80)) invalid();
    if (smallSize() !== 33) invalid();
    const publicKey = read(33);
    if (publicKey[0] !== 2 && publicKey[0] !== 3) invalid();
  }
  const locktime = read(4);
  if (locktime.readUInt32LE() !== 0 || position !== bytes.length) invalid();
  const nonWitness = Buffer.concat([version, bytes.subarray(bodyStart, bodyEnd), locktime]);
  const first = createHash("sha256").update(nonWitness).digest();
  const txid = createHash("sha256").update(first).digest().reverse().toString("hex");
  return { hex: value, txid };
}
