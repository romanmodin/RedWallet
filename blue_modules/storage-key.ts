import { scryptAsync } from '@noble/hashes/scrypt';
import { NativeModules, Platform } from 'react-native';
import { hexToUint8Array, uint8ArrayToHex } from './uint8array-extras';

/** Same fixed scrypt cost for vaults and cache indexes on every platform. */
export async function deriveStorageKey(password: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  if (!password.length || password.length > 65536 || salt.length !== 16) throw new Error('Invalid storage key input');
  const native = NativeModules.BlueCrypto;
  if (typeof native?.scryptSecure === 'function') {
    // The existing crypto module executes off the JS thread. Fixed native costs
    // match RWV2 and cache v3; malformed results must never become a vault key.
    const result =
      Platform.OS === 'ios'
        ? await native.scryptSecure(Array.from(password), Array.from(salt))
        : await native.scryptSecure(uint8ArrayToHex(password), uint8ArrayToHex(salt));
    if (typeof result !== 'string' || !/^[a-f0-9]{64}$/i.test(result)) throw new Error('Storage key derivation failed');
    return hexToUint8Array(result);
  }
  // Node tests and environments without the native module retain the identical
  // algorithm. A native failure is propagated, never retried with weaker costs.
  return scryptAsync(password, salt, { N: 32768, r: 8, p: 3, dkLen: 32, maxmem: 40 * 1024 * 1024, asyncTick: 10 });
}
