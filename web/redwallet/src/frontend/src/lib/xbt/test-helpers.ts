import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha2";
/** Test-only adapter using the exact native noble versions and prehash rules. */
import * as secp256k1 from "@noble/secp256k1";

secp256k1.hashes.sha256 = (message) => Uint8Array.from(sha256(message));
secp256k1.hashes.hmacSha256 = (key, message) =>
  Uint8Array.from(hmac(sha256, key, message));

export const testEcc = {
  pointFromScalar: (key: Uint8Array, compressed = true) =>
    secp256k1.getPublicKey(key, compressed),
  sign: (hash: Uint8Array, key: Uint8Array) =>
    secp256k1.sign(hash, key, { prehash: false }),
  verify: (hash: Uint8Array, publicKey: Uint8Array, signature: Uint8Array) =>
    secp256k1.verify(signature, hash, publicKey, {
      prehash: false,
      lowS: true,
    }),
};
