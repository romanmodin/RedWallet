import { scryptSync } from 'crypto';
import { NativeModules, Platform } from 'react-native';
import { deriveStorageKey } from '../../blue_modules/storage-key';

const salt = Uint8Array.from({ length: 16 }, (_, i) => i);
const password = new Uint8Array(Buffer.from('storage test café 🛡'));
const reference = scryptSync(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 40 * 1024 * 1024 });
const originalNative = NativeModules.BlueCrypto;

afterEach(() => {
  NativeModules.BlueCrypto = originalNative;
  jest.restoreAllMocks();
});

it('preserves the existing Node-compatible key when native crypto is unavailable', async () => {
  NativeModules.BlueCrypto = undefined;
  expect(Buffer.from(await deriveStorageKey(password, salt))).toEqual(reference);
});

it.each(['ios', 'android'] as const)('passes exact password and salt bytes to native %s without Unicode normalization', async os => {
  jest.replaceProperty(Platform, 'OS', os);
  const native = jest.fn(async () => reference.toString('hex').toUpperCase());
  NativeModules.BlueCrypto = { scryptSecure: native };
  expect(Buffer.from(await deriveStorageKey(password, salt))).toEqual(reference);
  expect(native).toHaveBeenCalledWith(
    os === 'ios' ? Array.from(password) : Buffer.from(password).toString('hex'),
    os === 'ios' ? Array.from(salt) : Buffer.from(salt).toString('hex'),
  );
});

it('rejects malformed native results and propagates native failure', async () => {
  const native = jest.fn().mockResolvedValueOnce('00').mockRejectedValueOnce(new Error('native allocation failed'));
  NativeModules.BlueCrypto = { scryptSecure: native };
  await expect(deriveStorageKey(password, salt)).rejects.toThrow('Storage key derivation failed');
  await expect(deriveStorageKey(password, salt)).rejects.toThrow('native allocation failed');
  expect(native).toHaveBeenCalledTimes(2);
});

it('rejects invalid salt lengths and excessive password allocations before native access', async () => {
  const native = jest.fn();
  NativeModules.BlueCrypto = { scryptSecure: native };
  for (const [pwd, slt] of [
    [new Uint8Array(0), salt],
    [password, new Uint8Array(15)],
    [new Uint8Array(65537), salt],
  ]) {
    await expect(deriveStorageKey(pwd, slt)).rejects.toThrow('Invalid storage key input');
  }
  expect(native).not.toHaveBeenCalled();
});
