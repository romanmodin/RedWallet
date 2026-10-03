import Realm, { Configuration } from 'realm';
import { scryptAsync } from '@noble/hashes/scrypt';
import Keychain from 'react-native-keychain';
import { randomBytes } from '../class/rng';
import { hexToUint8Array, stringToUint8Array, uint8ArrayToHex } from './uint8array-extras';

const opening = new Map<string, Promise<Configuration>>();
let assigningPath: Promise<void> = Promise.resolve();
const PATH_SERVICE = 'redwallet-cache-paths-v3';
const LEGACY_PATH_SERVICE = 'redwallet-cache-paths-v2';
const indexes = new Map<string, Promise<string>>();

type CachePaths = { version: 3; salt: string; paths: Record<string, string> };

/** A copied Keychain mapping must not become a fast password-guessing oracle. */
function cacheIndex(cacheName: string, salt: string): Promise<string> {
  const memo = `${salt}:${cacheName}`;
  let task = indexes.get(memo);
  if (!task) {
    task = (async () => {
      const bytes = stringToUint8Array(`RedWallet cache index v3:${cacheName}`);
      let key: Uint8Array | undefined;
      try {
        key = await scryptAsync(bytes, hexToUint8Array(salt), {
          N: 32768,
          r: 8,
          p: 3,
          dkLen: 32,
          maxmem: 40 * 1024 * 1024,
          asyncTick: 10,
        });
        return uint8ArrayToHex(key);
      } finally {
        bytes.fill(0);
        key?.fill(0);
      }
    })();
    indexes.set(memo, task);
    task.catch(() => indexes.delete(memo));
  }
  return task;
}

/** Stable random filenames; any password-derived index is salted and memory-hard. */
function secureCachePath(legacyPath: string): Promise<string> {
  // iOS may change the container directory on update; the cache's basename stays stable.
  const cacheName = legacyPath.split('/').pop()!;
  const task = assigningPath.then(async () => {
    const credentials = await Keychain.getGenericPassword({ service: PATH_SERVICE });
    const record: CachePaths = credentials
      ? JSON.parse(credentials.password)
      : { version: 3, salt: uint8ArrayToHex(await randomBytes(16)), paths: {} };
    // Report the failed shape without exposing the stored salt, password index,
    // filenames or encryption keys. Native Keychain reads need their own checks.
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('Invalid secure cache mapping: record');
    if (record.version !== 3) throw new Error('Invalid secure cache mapping: version');
    if (typeof record.salt !== 'string' || !/^[a-f0-9]{32}$/.test(record.salt)) throw new Error('Invalid secure cache mapping: salt');
    if (!record.paths || typeof record.paths !== 'object' || Array.isArray(record.paths))
      throw new Error('Invalid secure cache mapping: paths');
    const index = await cacheIndex(cacheName, record.salt);
    const oldCredentials = await Keychain.getGenericPassword({ service: LEGACY_PATH_SERVICE });
    const oldPaths: Record<string, string> = oldCredentials ? JSON.parse(oldCredentials.password) : {};
    if (!oldPaths || typeof oldPaths !== 'object' || Array.isArray(oldPaths)) throw new Error('Invalid legacy cache mapping');
    if (!record.paths[index]) {
      record.paths[index] = oldPaths[cacheName] || uint8ArrayToHex(await randomBytes(16));
      if (!/^[a-f0-9]{32}$/.test(record.paths[index])) throw new Error('Invalid secure cache path');
      if (
        !(await Keychain.setGenericPassword(PATH_SERVICE, JSON.stringify(record), {
          service: PATH_SERVICE,
          accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        }))
      )
        throw new Error('Could not save secure cache path');
    }
    if (!/^[a-f0-9]{32}$/.test(record.paths[index])) throw new Error('Invalid secure cache path');
    // Persist the new mapping before removing the active bucket's old fast fingerprint.
    // Other buckets remain readable and upgrade when their password is supplied.
    if (Object.prototype.hasOwnProperty.call(oldPaths, cacheName)) {
      delete oldPaths[cacheName];
      const removed = Object.keys(oldPaths).length
        ? await Keychain.setGenericPassword(LEGACY_PATH_SERVICE, JSON.stringify(oldPaths), {
            service: LEGACY_PATH_SERVICE,
            accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          })
        : await Keychain.resetGenericPassword({ service: LEGACY_PATH_SERVICE });
      if (!removed) throw new Error('Could not remove legacy cache fingerprint; existing data was preserved');
    }
    const directory = legacyPath.slice(0, legacyPath.lastIndexOf('/') + 1);
    return `${directory}redwallet-cache-${record.paths[index]}.realm`;
  });
  assigningPath = task.then(
    () => {},
    () => {},
  );
  return task;
}

/** Migrate a cache once; retain the old file until the new encrypted copy opens successfully. */
export async function openSecureRealm(legacy: Configuration): Promise<Realm> {
  const legacyPath = legacy.path!;
  const pending = opening.get(legacyPath);
  if (pending) return Realm.open(await pending);
  const task = (async () => {
    const path = await secureCachePath(legacyPath);
    const service = `redwallet-realm:${path.split('/').pop()}`;
    const credentials = await Keychain.getGenericPassword({ service });
    let key: Uint8Array;
    if (credentials) {
      key = hexToUint8Array(credentials.password);
      if (key.length !== 64) throw new Error('Invalid secure cache key');
    } else {
      if (Realm.exists({ path })) throw new Error('Secure cache key is unavailable; existing data was preserved');
      key = await randomBytes(64);
      const saved = await Keychain.setGenericPassword(service, uint8ArrayToHex(key), {
        service,
        accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      if (!saved) throw new Error('Could not save secure cache key');
    }
    const config = {
      ...legacy,
      path,
      encryptionKey: Int8Array.from(key),
      excludeFromIcloudBackup: true,
    };
    key.fill(0);
    if (!Realm.exists({ path }) && Realm.exists({ path: legacyPath })) {
      const previous = await Realm.open(legacy);
      try {
        previous.writeCopyTo(config);
        const migrated = await Realm.open(config);
        migrated.close();
      } catch (error) {
        // A failed migration never replaces or deletes the original cache.
        Realm.deleteFile({ path });
        throw error;
      } finally {
        previous.close();
      }
    }
    const realm = await Realm.open(config);
    if (Realm.exists({ path: legacyPath })) Realm.deleteFile({ path: legacyPath });
    realm.close();
    return config;
  })();
  opening.set(legacyPath, task);
  try {
    return Realm.open(await task);
  } finally {
    opening.delete(legacyPath);
  }
}
